import io
import os
import tempfile
import pandas as pd
import pyreadstat


def load_file(content: bytes, filename: str) -> pd.DataFrame:
    """
    统一文件加载接口，支持 CSV / Excel / DTA
    """
    ext = filename.rsplit(".", 1)[-1].lower()

    if ext == "csv":
        for encoding in ["utf-8", "gbk", "gb2312", "utf-8-sig"]:
            try:
                return pd.read_csv(io.BytesIO(content), encoding=encoding)
            except UnicodeDecodeError:
                continue
        raise ValueError(f"无法识别 {filename} 的编码格式")

    elif ext == "xlsx":
        return pd.read_excel(io.BytesIO(content))

    elif ext == "dta":
        # pyreadstat 不支持 BytesIO，必须写入临时文件再读取
        suffix = ".dta"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            df, meta = pyreadstat.read_dta(tmp_path)
        finally:
            os.unlink(tmp_path)  # 确保临时文件被清理
        return df

    else:
        raise ValueError(f"不支持的文件格式：{ext}，请上传 .csv / .xlsx / .dta 文件")
