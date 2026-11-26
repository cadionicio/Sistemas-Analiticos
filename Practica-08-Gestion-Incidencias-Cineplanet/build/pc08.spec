# PyInstaller · PC08.exe (un solo archivo: se puede abrir incluso desde dentro del ZIP; ventana propia sin consola). La solución HTML se entrega aparte.
import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files
RAIZ = os.path.abspath(os.path.join(SPECPATH, ".."))
datos = [(os.path.join(RAIZ, "web"), "web"), (os.path.join(RAIZ, "exe", "pc08", "migraciones"), os.path.join("pc08", "migraciones"))]
datos += collect_data_files("webview")
ocultos = collect_submodules("webview") + ["clr", "pythonnet", "clr_loader", "bottle", "proxy_tools"]
a = Analysis([os.path.join(RAIZ, "lanzar_pc08.py")], pathex=[os.path.join(RAIZ, "exe")], datas=datos, hiddenimports=ocultos,
             excludes=["tkinter", "matplotlib", "numpy", "pandas", "PIL", "PyQt5", "PyQt6", "PySide2", "PySide6", "gi"])
exe = EXE(PYZ(a.pure), a.scripts, a.binaries, a.datas, [], name="PC08", console=False, upx=False, runtime_tmpdir=None,
          icon=os.path.join(SPECPATH, "pc08.ico"), version=os.path.join(SPECPATH, "version.txt"))
