from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status
import logging

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    """Unified exception handler returning consistent JSON error structure."""
    response = exception_handler(exc, context)
    if response is not None:
        error_data = {
            "success": False,
            "error": {
                "code": response.status_code,
                "message": str(exc.detail) if hasattr(exc, "detail") else str(exc),
                "details": response.data,
            },
        }
        logger.warning("API Error [%s]: %s", response.status_code, str(exc)[:200])
        return Response(error_data, status=response.status_code)

    logger.error("Unhandled exception: %s", str(exc)[:300], exc_info=True)
    return Response(
        {
            "success": False,
            "error": {
                "code": 500,
                "message": "服务器内部错误，请稍后重试",
            },
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
