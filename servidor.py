import http.server
import socketserver
import os
import json
import threading
import subprocess
import sys
from urllib.parse import urlparse
from urllib.parse import parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
SRC_MODELS_DIR = os.path.join(ASSETS_DIR, 'Modelos_Oculos')
DST_MODELS_DIR = os.path.join(ASSETS_DIR, 'Modelos_Corrigidos')

try:
    from converter_local import convert_stl_to_gltf_group, list_gltf_models
except Exception:
    convert_stl_to_gltf_group = None
    list_gltf_models = None

def choose_port(default=8000, max_tries=5):
    env_port = os.getenv("PORT")
    start = int(env_port) if env_port and env_port.isdigit() else default
    for i in range(max_tries):
        yield start + i

PORT_CANDIDATES = list(choose_port())

# Este manipulador simples serve arquivos a partir do diretório
# onde o script Python é executado. É o ideal para a sua estrutura de pastas.
class Handler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler com um endpoint API simples e arquivos estáticos."""

    def do_GET(self):
        if self.path == "/api/models":
            self._handle_models()
            return
        if self.path.startswith("/api/review-count"):
            self._handle_review_count()
            return
        if self.path.startswith("/api/gltf-models"):
            self._handle_gltf_models()
            return
        return super().do_GET()

    def _handle_models(self):
        # Mantém endpoint legado para a UI atual (se necessário)
        stl_dir = SRC_MODELS_DIR
        fbx_dir = os.path.join(ASSETS_DIR, "Modelos_FBX")

        def list_files(folder, ext):
            if not os.path.isdir(folder):
                return []
            return sorted([
                f for f in os.listdir(folder)
                if f.lower().endswith(ext)
            ])

        stl = list_files(stl_dir, ".stl")
        fbx = list_files(fbx_dir, ".fbx")

        # Retorna nomes e URLs relativas para o front carregar
        data = {
            "stl": [
                {
                    "name": os.path.splitext(n)[0],
                    "url": f"/assets/Modelos_Oculos/{n}",
                } for n in stl
            ],
            "fbx": [
                {
                    "name": os.path.splitext(n)[0],
                    "url": f"/assets/Modelos_FBX/{n}",
                } for n in fbx
            ],
        }

        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_review_count(self):
        pending = 0
        if os.path.isdir(SRC_MODELS_DIR):
            stls = [f for f in os.listdir(SRC_MODELS_DIR) if f.lower().endswith('.stl')]
            for name in stls:
                base = os.path.splitext(name)[0]
                out_gltf = os.path.join(DST_MODELS_DIR, f"{base}.gltf")
                if not os.path.exists(out_gltf):
                    pending += 1
        body = json.dumps({"count": pending}).encode('utf-8')
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_gltf_models(self):
        items = []
        if list_gltf_models:
            items = list_gltf_models(DST_MODELS_DIR)
        body = json.dumps({"gltf": items}).encode('utf-8')
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.startswith('/api/convert'):
            return self._handle_convert()
        return super().do_POST()

    def _handle_convert(self):
        if not convert_stl_to_gltf_group:
            body = json.dumps({"ok": False, "error": "Conversor indisponível"}).encode('utf-8')
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # Executa conversão de forma síncrona para simplificar
        summary = convert_stl_to_gltf_group(SRC_MODELS_DIR, DST_MODELS_DIR)
        body = json.dumps({"ok": True, **summary}).encode('utf-8')
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def try_convert_models_async():
    """Dispara conversão STL→FBX em thread separada (melhor-esforço)."""
    base = os.path.dirname(os.path.abspath(__file__))
    driver = os.path.join(base, "convert_stl_to_fbx.py")
    py_exec = sys.executable or "python"
    if not os.path.exists(driver):
        return

    def worker():
        try:
            # Tenta converter, sem overwrite, logs silenciosos
            cmd = [py_exec, driver]
            subprocess.run(cmd, cwd=base, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except Exception:
            pass

    t = threading.Thread(target=worker, daemon=True)
    t.start()

# Garante que o servidor rode a partir do diretório onde o script está
os.chdir(BASE_DIR)

class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

# Inicia o servidor tentando múltiplas portas
httpd = None
bound_port = None
for PORT in PORT_CANDIDATES:
    try:
        httpd = ReuseTCPServer(("", PORT), Handler)
        bound_port = PORT
        break
    except OSError:
        continue

if httpd is None:
    raise OSError("Não foi possível iniciar o servidor: todas as portas testadas estão em uso.")

with httpd:
    print("Servidor iniciado com sucesso!")
    print(f"Acesse o site em: http://127.0.0.1:{bound_port}/web/index.html")
    print(f"Endpoint de modelos: http://127.0.0.1:{bound_port}/api/models")
    try_convert_models_async()
    httpd.serve_forever()