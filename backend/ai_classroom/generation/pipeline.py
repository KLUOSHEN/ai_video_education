"""
音视频生成流水线 — 5 阶段异步管道

Stage 1: 题目分析 (DeepSeek 求解)
Stage 2: 剧本生成 (DeepSeek 剧本)
Stage 3: 场景图像生成 (Doubao/Seedream)
Stage 4: 语音合成 (edge-tts)
Stage 5: 视频合成 (moviepy)
"""

import os
import time
import json
import logging
import subprocess
import tempfile
from datetime import datetime

from django.conf import settings

logger = logging.getLogger(__name__)


def _run_generation_pipeline(task_id: int, voice_id: str, voice_rate: str):
    """
    在后台线程中串行执行 5 阶段生成管道。
    每阶段完成后更新 task 状态。
    """
    from api.models import VideoGeneration, Scene

    try:
        task = VideoGeneration.objects.get(id=task_id)
    except VideoGeneration.DoesNotExist:
        logger.error("Task #%d not found, aborting pipeline.", task_id)
        return

    cfg = settings.AISERVICE_CONFIG
    scene_count = task.total_scenes

    # ── Stage 1: 题目分析 ──
    logger.info("Task #%d: Stage 1 — analyzing query", task_id)
    task.status = VideoGeneration.Status.ANALYZING
    task.progress = 10
    task.save(update_fields=["status", "progress"])

    try:
        analysis = _call_deepseek(
            messages=[
                {"role": "system", "content": "你是 AI 数学白板教授，请用 JSON 回复，只输出 JSON。"},
                {"role": "user", "content": f"分析以下题目，返回: {{key_points:[], difficulty:'easy|medium|hard', answer_summary:'string'}}\n{task.query}"},
            ],
            cfg=cfg["deepseek"],
        )
        analysis_data = json.loads(analysis)
    except Exception as e:
        logger.warning("Stage 1 fallback: %s", e)
        analysis_data = {"key_points": [task.query], "difficulty": "medium", "answer_summary": task.query}

    task.progress = 20
    task.save(update_fields=["progress"])

    # ── Stage 2: 剧本生成 ──
    logger.info("Task #%d: Stage 2 — generating script", task_id)
    task.status = VideoGeneration.Status.SCRIPTING
    task.save(update_fields=["status"])

    try:
        script_data = _call_deepseek(
            messages=[
                {"role": "system", "content": (
                    "你是白板教学视频剧本师。返回 JSON 数组，每个元素: "
                    "{scene:序号, narration:'配音旁白', caption:'屏幕字幕', visual:'白板画面描述'}"
                )},
                {"role": "user", "content": (
                    f"为以下题目编写 {scene_count} 个场景的教学剧本: {task.query}\n"
                    f"难度: {analysis_data.get('difficulty','medium')}\n"
                    f"要点: {analysis_data.get('key_points',[])}"
                )},
            ],
            cfg=cfg["deepseek"],
        )
        scenes_data = json.loads(script_data)
    except Exception as e:
        logger.warning("Stage 2 fallback: %s", e)
        scenes_data = [
            {"scene": i + 1, "narration": f"第{i+1}步", "caption": task.query, "visual": ""}
            for i in range(scene_count)
        ]

    task.progress = 40
    task.save(update_fields=["progress"])

    # ── Stage 3~4: 逐场景生成 ──
    logger.info("Task #%d: Stage 3 — rendering scenes", task_id)
    task.status = VideoGeneration.Status.RENDERING
    task.completed_scenes = 0
    task.save(update_fields=["status", "completed_scenes"])

    scene_objects = []

    for scene_entry in scenes_data:
        si = scene_entry.get("scene", len(scene_objects) + 1)
        narration = scene_entry.get("narration", "")
        caption = scene_entry.get("caption", "")
        visual = scene_entry.get("visual", "")

        scene = Scene.objects.create(
            task=task,
            scene_index=si,
            scene_description=visual,
            script_text=caption or narration,
            status="generating",
        )
        scene_objects.append(scene)

        # Stage 3a: 生成场景图
        try:
            img_path = _generate_scene_image(visual or caption, si, task)
            if img_path and os.path.exists(img_path):
                rel_path = os.path.relpath(img_path, settings.MEDIA_ROOT)
                scene.image = rel_path
        except Exception as e:
            logger.warning("Scene %d image error: %s", si, e)

        # Stage 3b: 配音
        try:
            audio_path = _generate_tts(narration, voice_id, voice_rate, task_id, si)
            if audio_path and os.path.exists(audio_path):
                rel_path = os.path.relpath(audio_path, settings.MEDIA_ROOT)
                scene.audio = rel_path
        except Exception as e:
            logger.warning("Scene %d TTS error: %s", si, e)

        scene.status = "completed"
        scene.save(update_fields=["image", "audio", "status"])

        task.completed_scenes += 1
        task.progress = 40 + int((task.completed_scenes / scene_count) * 40)
        task.save(update_fields=["completed_scenes", "progress"])

    # ── Stage 5: 视频合成 ──
    task.status = VideoGeneration.Status.SYNTHESIZING
    task.progress = 85
    task.save(update_fields=["status", "progress"])

    try:
        video_path = _compose_video(scene_objects, task)
        if video_path and os.path.exists(video_path):
            rel_path = os.path.relpath(video_path, settings.MEDIA_ROOT)
            task.output_video = rel_path
    except Exception as e:
        logger.error("Stage 5 video composition error: %s", e)

    task.status = VideoGeneration.Status.COMPLETED
    task.progress = 100
    task.completed_at = datetime.now()
    task.save(update_fields=["status", "progress", "output_video", "completed_at"])
    logger.info("Task #%d: pipeline completed!", task_id)


def _call_deepseek(messages: list, cfg: dict) -> str:
    """调用 DeepSeek API"""
    api_key = cfg.get("api_key")
    if not api_key:
        raise RuntimeError("DeepSeek API key not configured")

    import urllib.request, urllib.error
    url = f"{cfg['base_url']}/v1/chat/completions"
    body = json.dumps({
        "model": cfg["model"],
        "messages": messages,
        "max_tokens": cfg["max_tokens"],
        "temperature": cfg["temperature"],
    }).encode("utf-8")

    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            content = data["choices"][0]["message"]["content"]

            # 提取 JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            return content.strip()
    except Exception as e:
        raise RuntimeError(f"DeepSeek API call failed: {e}")


def _generate_tts(text: str, voice: str, rate: str, task_id: int, scene_idx: int) -> str:
    """调用 edge-tts 生成配音文件"""
    if not text:
        return ""

    output_dir = os.path.join(settings.MEDIA_ROOT, "audio")
    os.makedirs(output_dir, exist_ok=True)
    filename = f"task{task_id}_scene{scene_idx}.mp3"
    filepath = os.path.join(output_dir, filename)

    try:
        # edge-tts CLI
        cmd = [
            "edge-tts",
            "--text", text,
            "--voice", voice,
            "--rate", rate,
            "--write-media", filepath,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            logger.error("TTS failed: %s", result.stderr[:200])
            return ""
        return filepath
    except FileNotFoundError:
        logger.warning("edge-tts not installed; creating empty placeholder")
        # placeholder — create an empty file for API compatibility
        with open(filepath, "wb") as f:
            f.write(b"")
        return filepath
    except Exception as e:
        logger.warning("TTS exception: %s", e)
        return ""


def _generate_scene_image(prompt: str, scene_idx: int, task) -> str:
    """生成场景白板插图"""
    if not prompt:
        prompt = task.query

    output_dir = os.path.join(settings.MEDIA_ROOT, "images")
    os.makedirs(output_dir, exist_ok=True)
    filename = f"task{task.id}_scene{scene_idx}.png"
    filepath = os.path.join(output_dir, filename)

    # 尝试 Doubao API；失败则生成占位图
    cfg = settings.AISERVICE_CONFIG["doubao"]
    if cfg.get("api_key"):
        try:
            import urllib.request
            body = json.dumps({"prompt": f"白板教学风格：{prompt}", "size": "1280x960"}).encode()
            req = urllib.request.Request(f"{cfg['base_url']}/images/generate", data=body, headers={
                "Authorization": f"Bearer {cfg['api_key']}",
                "Content-Type": "application/json",
            })
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
                img_url = data.get("data", [{}])[0].get("url", "")
                if img_url:
                    urllib.request.urlretrieve(img_url, filepath)
                    return filepath
        except Exception as e:
            logger.warning("Doubao API error: %s", e)

    # Fallback: 纯色占位图
    _create_placeholder_image(filepath, prompt)
    return filepath


def _create_placeholder_image(filepath: str, text: str):
    """生成纯色占位图（无 matplotlib 依赖时的 fallback）"""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(12.8, 9.6), dpi=100)
        ax.set_facecolor("#f0f6ff")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.text(0.5, 0.5, text[:80], ha="center", va="center", fontsize=18, color="#4a8eff",
                transform=ax.transAxes, wrap=True)
        ax.axis("off")
        fig.savefig(filepath, dpi=100, bbox_inches="tight", facecolor="#f0f6ff")
        plt.close(fig)
    except ImportError:
        # 创建最小的白色 PNG
        import struct, zlib
        def create_png():
            width, height = 1280, 960
            raw = b""
            for y in range(height):
                raw += b"\x00" + b"\xf0\xf6\xff" * width
            compressed = zlib.compress(raw)
            def chunk(chunk_type, data):
                c = chunk_type + data
                crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
                return struct.pack(">I", len(data)) + c + crc
            ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
            with open(filepath, "wb") as f:
                f.write(b"\x89PNG\r\n\x1a\n")
                f.write(chunk(b"IHDR", ihdr))
                f.write(chunk(b"IDAT", compressed))
                f.write(chunk(b"IEND", b""))
        create_png()


def _compose_video(scenes: list, task) -> str:
    """用 moviepy 合成 MP4 视频"""
    output_dir = os.path.join(settings.MEDIA_ROOT, "videos")
    os.makedirs(output_dir, exist_ok=True)
    filename = f"output_{task.id}.mp4"
    filepath = os.path.join(output_dir, filename)

    try:
        from moviepy import ImageClip, AudioFileClip, CompositeVideoClip, TextClip, concatenate_videoclips

        clips = []
        for scene in scenes:
            # 图像 clip
            img_path = scene.image.path if scene.image else None
            if img_path and os.path.exists(img_path):
                clip = ImageClip(img_path, duration=scene.duration)
            else:
                # 纯色 clip
                import numpy as np
                frame = np.zeros((960, 1280, 3), dtype=np.uint8)
                frame[:] = [240, 246, 255]
                clip = ImageClip(frame, duration=scene.duration)

            # 字幕
            if scene.script_text:
                txt_clip = TextClip(
                    font="Microsoft YaHei",
                    text=scene.script_text,
                    font_size=32, color="white",
                    stroke_color="black", stroke_width=1,
                    size=(1100, None), method="caption",
                ).with_position(("center", 800)).with_duration(scene.duration)
                clip = CompositeVideoClip([clip, txt_clip])

            # 配音
            audio_path = scene.audio.path if scene.audio else None
            if audio_path and os.path.exists(audio_path) and os.path.getsize(audio_path) > 0:
                audio = AudioFileClip(audio_path)
                clip = clip.with_audio(audio)

            clips.append(clip)

        final = concatenate_videoclips(clips)
        final.write_videofile(
            filepath,
            fps=24,
            codec="libx264",
            audio_codec="aac",
            temp_audiofile=os.path.join(tempfile.gettempdir(), f"temp_audio_{task.id}.m4a"),
            remove_temp=True,
            logger=None,
        )
        return filepath
    except ImportError:
        logger.warning("moviepy not installed; creating placeholder")
        with open(filepath, "wb") as f:
            f.write(b"")
        return filepath
    except Exception as e:
        logger.error("Video composition error: %s", e)
        return ""
