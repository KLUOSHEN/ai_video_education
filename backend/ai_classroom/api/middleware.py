import time
import logging
from collections import defaultdict
from django.http import JsonResponse
from django.conf import settings

logger = logging.getLogger(__name__)

_rate_records = defaultdict(list)


class RateLimitMiddleware:
    """Simple in-memory rate limiter."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.window = 60
        self.max_requests = 60

    def __call__(self, request):
        if request.path.startswith("/api/"):
            ip = self._get_client_ip(request)
            now = time.time()
            _rate_records[ip] = [t for t in _rate_records[ip] if now - t < self.window]
            if len(_rate_records[ip]) >= self.max_requests:
                logger.warning("Rate limit exceeded for IP: %s", ip)
                return JsonResponse(
                    {"success": False, "error": {"code": 429, "message": "请求过于频繁，请稍后重试"}},
                    status=429,
                )
            _rate_records[ip].append(now)
        return self.get_response(request)

    @staticmethod
    def _get_client_ip(request):
        x_forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded:
            return x_forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "127.0.0.1")


class RequestLoggingMiddleware:
    """Logs every API request."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.time()
        response = self.get_response(request)
        elapsed = time.time() - start
        if request.path.startswith("/api/"):
            logger.info(
                "%s %s → %s (%.2fs)",
                request.method,
                request.path,
                response.status_code,
                elapsed,
            )
        return response
