# PyInstaller spec — tracker.py'yi tek dosyalik calistirilabilir hale getirir
# (Faz 10-B: kurulumsuz kisi takibi). ONNX modelleri exe'nin icine gomulur;
# calisirken sys._MEIPASS altina acilir (bkz. tracker.py DIR mantigi).
#
# Kullanim (her platformda CI'de):
#   pyinstaller tracker.spec
# Cikti: dist/tracker(.exe)
#
# Cross-platform: datas ayirici (';' vs ':') PyInstaller tarafindan otomatik
# ele alinir cunku tuple listesi kullaniyoruz.

a = Analysis(
    ['tracker.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('face_detection_yunet_2023mar.onnx', '.'),
        ('face_recognition_sface_2021dec.onnx', '.'),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Gereksiz agir modulleri disla — exe boyutunu kucultur (yalniz cv2+numpy gerek)
    excludes=['tkinter', 'matplotlib', 'PIL', 'scipy', 'pandas', 'pytest'],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='tracker',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,          # stdout/stderr (PROGRESS/DONE/ERROR) gorunmeli
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
