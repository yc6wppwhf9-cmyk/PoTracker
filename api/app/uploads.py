"""Reading an uploaded file without letting it decide how much memory to use."""

from fastapi import HTTPException, UploadFile

# 20 MB. A real RM sheet or GRN register is a few hundred kilobytes; the item
# master, the largest thing anyone legitimately sends, is single-digit
# megabytes. Twenty leaves generous room and still fits several concurrent
# uploads inside a small instance.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

_CHUNK = 1024 * 1024


def read_upload(
    file: UploadFile,
    what: str = "file",
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> bytes:
    """Read an upload, refusing anything over the limit.

    Read in chunks and STOPPED at the limit, rather than read whole and
    measured afterwards. The measured-afterwards version — which is what the
    GRN import did, and the only place that checked at all — has already spent
    the memory by the time it objects, so a single large file could take the
    instance down before the error it was meant to raise.

    It is also worth remembering what an .xlsx is: a zip. A few megabytes of
    compressed XML can expand to a great deal more, so this bound is on the
    upload only. Parsing is separately protected by openpyxl's read-only mode
    and by the row limits in the parsers.
    """
    buf = bytearray()
    while True:
        chunk = file.file.read(_CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise HTTPException(
                413,
                f"That {what} is larger than the {max_bytes // 1_048_576} MB "
                "limit this service accepts. Split it, or remove any embedded "
                "images and unused sheets, and try again.",
            )

    if not buf:
        raise HTTPException(400, f"The uploaded {what} is empty.")
    return bytes(buf)
