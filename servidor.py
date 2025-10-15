import http.server
import socketserver
import os

PORT = 8000 

# Este manipulador simples serve arquivos a partir do diretório
# onde o script Python é executado. É o ideal para a sua estrutura de pastas.
Handler = http.server.SimpleHTTPRequestHandler

# Garante que o servidor rode a partir do diretório onde o script está
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Inicia o servidor
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print("Servidor iniciado com sucesso!")
    # O URL de acesso agora aponta diretamente para o arquivo html dentro da pasta web
    print(f"Acesse o site em: http://127.0.0.1:{PORT}/web/index.html")
    httpd.serve_forever()