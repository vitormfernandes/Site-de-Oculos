import os
import sys
import json
from typing import List, Tuple


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Adiciona caminho do conversor já existente (usa apenas stl2gltf que não tem dependências externas)
CONVERTER_SERVER_DIR = os.path.join(BASE_DIR, 'conversor de formatos 3D', '3d-model-convert-to-gltf', 'server')
if os.path.isdir(CONVERTER_SERVER_DIR) and CONVERTER_SERVER_DIR not in sys.path:
    sys.path.append(CONVERTER_SERVER_DIR)

try:
    from service.stl2gltf import stl_to_gltf  # type: ignore
except Exception as e:
    stl_to_gltf = None  # fallback será tratado


def is_binary_stl(path_to_stl: str) -> bool:
    """Verifica se STL é binário (método adaptado do conversor)."""
    import struct
    header_bytes = 80
    unsigned_long_int_bytes = 4
    float_bytes = 4
    vec3_bytes = 4 * 3
    spacer_bytes = 2

    try:
        with open(path_to_stl, 'rb') as f:
            f.seek(header_bytes)
            num_faces_bytes = f.read(unsigned_long_int_bytes)
            if len(num_faces_bytes) != unsigned_long_int_bytes:
                return False
            number_faces = struct.unpack('<I', num_faces_bytes)[0]
            stl_assume_bytes = header_bytes + unsigned_long_int_bytes + number_faces * (
                vec3_bytes * 3 + spacer_bytes + vec3_bytes
            )
            return stl_assume_bytes == os.path.getsize(path_to_stl)
    except Exception:
        return False


def ascii_stl_to_binary(ascii_path: str, binary_out_path: str) -> None:
    """Converte STL ASCII para STL binário simples.
    Implementação minimalista: lê linhas facet/vertex e grava triângulos.
    """
    import struct

    normals: List[Tuple[float, float, float]] = []
    triangles: List[Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]] = []

    current_normal = (0.0, 0.0, 0.0)
    current_vertices: List[Tuple[float, float, float]] = []

    def flush_triangle():
        nonlocal current_vertices, current_normal
        if len(current_vertices) == 3:
            triangles.append((current_vertices[0], current_vertices[1], current_vertices[2]))
            normals.append(current_normal)
        current_vertices = []

    with open(ascii_path, 'r', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if line.startswith('facet normal'):
                parts = line.split()
                if len(parts) >= 5:
                    try:
                        current_normal = (float(parts[2]), float(parts[3]), float(parts[4]))
                    except ValueError:
                        current_normal = (0.0, 0.0, 0.0)
            elif line.startswith('vertex'):
                parts = line.split()
                if len(parts) >= 4:
                    try:
                        v = (float(parts[1]), float(parts[2]), float(parts[3]))
                        current_vertices.append(v)
                    except ValueError:
                        pass
            elif line.startswith('endfacet'):
                flush_triangle()

    # Escreve STL binário
    with open(binary_out_path, 'wb') as out:
        out.write(b'Converted ASCII STL to Binary' + b' ' * (80 - len('Converted ASCII STL to Binary')))
        out.write(struct.pack('<I', len(triangles)))
        for normal, tri in zip(normals, triangles):
            out.write(struct.pack('<3f', *normal))
            out.write(struct.pack('<3f', *tri[0]))
            out.write(struct.pack('<3f', *tri[1]))
            out.write(struct.pack('<3f', *tri[2]))
            out.write(struct.pack('<H', 0))  # attribute byte count


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _rewrite_gltf_uri(gltf_path: str, new_bin_name: str) -> None:
    """Reescreve a URI do buffer no glTF para apontar para o novo nome do .bin."""
    try:
        import json as _json
        with open(gltf_path, 'r', encoding='utf-8') as f:
            data = _json.load(f)
        if 'buffers' in data and isinstance(data['buffers'], list) and data['buffers']:
            if 'uri' in data['buffers'][0]:
                data['buffers'][0]['uri'] = new_bin_name
        with open(gltf_path, 'w', encoding='utf-8') as f:
            _json.dump(data, f)
    except Exception:
        pass


def convert_stl_to_gltf_group(src_dir: str, dst_dir: str) -> dict:
    """Converte todos os .stl do src_dir para glTF no dst_dir.

    Retorna um resumo com convertidos, ignorados e erros.
    """
    if stl_to_gltf is None:
        return {"converted": [], "skipped": [], "errors": ["Conversor stl_to_gltf indisponível"]}

    ensure_dir(dst_dir)
    converted: List[str] = []
    skipped: List[str] = []
    errors: List[str] = []

    for name in sorted(os.listdir(src_dir)):
        if not name.lower().endswith('.stl'):
            continue
        src_path = os.path.join(src_dir, name)
        model_name = os.path.splitext(name)[0]
        out_gltf = os.path.join(dst_dir, f'{model_name}.gltf')
        out_bin = os.path.join(dst_dir, f'{model_name}.bin')

        # Já convertido
        if os.path.exists(out_gltf):
            skipped.append(model_name)
            continue

        try:
            ensure_dir(dst_dir)
            stl_source = src_path
            temp_bin_stl = None
            if not is_binary_stl(src_path):
                temp_bin_stl = os.path.join(dst_dir, model_name + '.binary.stl')
                ascii_stl_to_binary(src_path, temp_bin_stl)
                stl_source = temp_bin_stl

            # Converte gerando glTF (JSON + BIN) inicialmente como out.gltf/out.bin em uma pasta temporária
            temp_dir = os.path.join(dst_dir, f'.tmp_{model_name}')
            ensure_dir(temp_dir)
            stl_to_gltf(stl_source, temp_dir, is_binary=False)

            # Move/renomeia para a estrutura flat
            tmp_gltf = os.path.join(temp_dir, 'out.gltf')
            tmp_bin = os.path.join(temp_dir, 'out.bin')
            if os.path.exists(tmp_gltf):
                # Ajusta URI do binário dentro do glTF para <model>.bin
                try:
                    import shutil as _shutil
                    _shutil.copy2(tmp_gltf, out_gltf)
                    _shutil.copy2(tmp_bin, out_bin)
                    _rewrite_gltf_uri(out_gltf, f'{model_name}.bin')
                    converted.append(model_name)
                except Exception as e:
                    errors.append(f"{model_name}: falha ao mover arquivos - {e}")
                finally:
                    # Limpa tmp
                    try:
                        for p in (tmp_gltf, tmp_bin):
                            if p and os.path.exists(p):
                                os.remove(p)
                        os.rmdir(temp_dir)
                    except OSError:
                        pass
            else:
                errors.append(f"Falha ao gerar glTF para {model_name}")

            # Limpa temporários
            if temp_bin_stl and os.path.exists(temp_bin_stl):
                try:
                    os.remove(temp_bin_stl)
                except OSError:
                    pass
        except Exception as e:
            errors.append(f"{model_name}: {e}")

    return {"converted": converted, "skipped": skipped, "errors": errors}


def list_gltf_models(dst_dir: str) -> List[dict]:
    items = []
    if not os.path.isdir(dst_dir):
        return items
    for fname in sorted(os.listdir(dst_dir)):
        if not fname.lower().endswith('.gltf'):
            continue
        name = os.path.splitext(fname)[0]
        items.append({
            'name': name,
            'url': f"/assets/Modelos_Corrigidos/{fname}",
        })
    return items


if __name__ == '__main__':
    # Pequeno runner manual (opcional)
    src = os.path.join(BASE_DIR, 'assets', 'Modelos_Oculos')
    dst = os.path.join(BASE_DIR, 'assets', 'Modelos_Corrigidos')
    summary = convert_stl_to_gltf_group(src, dst)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
