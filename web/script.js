let previewScene, previewCamera, previewRenderer, previewModel, previewControls;
const previewContainer = document.getElementById('preview-3d');
const modelSelect = document.getElementById('modelSelect');
const reviewBtn = document.getElementById('reviewBtn');
const reviewCountEl = document.getElementById('reviewCount');

async function fetchReviewCount() {
    try {
        const res = await fetch('/api/review-count');
        if (!res.ok) throw new Error('Falha ao obter contagem');
        const data = await res.json();
        return data.count ?? 0;
    } catch (e) {
        return 0;
    }
}

async function fetchGltfModels() {
    try {
        const res = await fetch('/api/gltf-models');
        if (!res.ok) throw new Error('Falha ao obter gltfs');
        const data = await res.json();
        return data.gltf ?? [];
    } catch (e) {
        return [];
    }
}

function initPreview() {
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0xf5f5f5);

    previewCamera = new THREE.PerspectiveCamera(65, previewContainer.clientWidth / previewContainer.clientHeight, 0.01, 50000);
    previewCamera.position.z = 50;

    previewRenderer = new THREE.WebGLRenderer({ antialias: true });
    previewRenderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
    previewContainer.appendChild(previewRenderer.domElement);

    // Iluminação melhorada
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    previewScene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(5, 10, 7.5);
    previewScene.add(directionalLight);
    
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight2.position.set(-5, -3, -7);
    previewScene.add(directionalLight2);
    
    const pointLight = new THREE.PointLight(0xffffff, 0.6);
    pointLight.position.set(-6, -8, 12);
    previewScene.add(pointLight);

    // Grid helper para referência
    const gridHelper = new THREE.GridHelper(20, 20, 0xcccccc, 0xe0e0e0);
    gridHelper.position.y = -3;
    previewScene.add(gridHelper);

    previewControls = new THREE.OrbitControls(previewCamera, previewRenderer.domElement);
    previewControls.enableDamping = true;
    previewControls.minDistance = 0.1;
    previewControls.maxDistance = 100000;

    function animate() {
        requestAnimationFrame(animate);
        if (previewModel) {
            previewModel.rotation.y += 0.0025;
        }
        previewControls.update();
        previewRenderer.render(previewScene, previewCamera);
    }
    animate();
}

function clearModel() {
    if (!previewModel) return;
    previewScene.remove(previewModel);
    previewModel.traverse?.((n) => {
        if (n.isMesh) {
            n.geometry?.dispose?.();
            if (n.material?.map) n.material.map.dispose();
            n.material?.dispose?.();
        }
    });
    previewModel = null;
}

function ensureMaterial(object) {
    const baseMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a,
        metalness: 0.7, 
        roughness: 0.3, 
        side: THREE.DoubleSide,
        flatShading: false
    });
    
    object.traverse((n) => {
        if (!n.isMesh) return;
        n.frustumCulled = false;
        if (n.geometry && !n.geometry.attributes?.normal) {
            n.geometry.computeVertexNormals();
        }
        if (!n.material) {
            n.material = baseMaterial.clone();
        } else {
            // Força cor escura para óculos
            if (n.material.color) {
                n.material.color.setHex(0x1a1a1a);
            }
            if ('metalness' in n.material) n.material.metalness = 0.7;
            if ('roughness' in n.material) n.material.roughness = 0.3;
            if ('side' in n.material) n.material.side = THREE.DoubleSide;
            if ('flatShading' in n.material) n.material.flatShading = false;
        }
        n.castShadow = true;
        n.receiveShadow = true;
    });
}

function fixGeometry(object) {
    object.traverse((n) => {
        if (!n.isMesh || !n.geometry) return;
        const g = n.geometry;
        const pos = g.attributes?.position;
        const idx = g.index;
        if (idx && pos && pos.count <= 65535 && idx.array && idx.array.constructor === Uint32Array) {
            const a = idx.array;
            const arr16 = new Uint16Array(a.length);
            for (let i = 0; i < a.length; i++) arr16[i] = a[i];
            g.setIndex(new THREE.BufferAttribute(arr16, 1));
        }
        g.computeBoundingBox();
        g.computeBoundingSphere();
    });
}

function robustCenterAndScale(object) {
    if (!object) return;

    object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    object.updateMatrixWorld(true);

    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const targetSize = 2.0;
    const scale = targetSize / maxDim;
    object.scale.multiplyScalar(scale);
    object.updateMatrixWorld(true);

    const normalizedBox = new THREE.Box3().setFromObject(object);
    const normalizedCenter = normalizedBox.getCenter(new THREE.Vector3());
    object.position.sub(normalizedCenter);
    object.updateMatrixWorld(true);

    const finalBox = new THREE.Box3().setFromObject(object);
    const finalSize = finalBox.getSize(new THREE.Vector3());

    const fov = THREE.MathUtils.degToRad(previewCamera.fov);
    const fitHeightDistance = finalSize.y / (2 * Math.tan(fov / 2));
    const fitWidthDistance = finalSize.x / (2 * Math.tan(fov / 2));
    const distance = Math.max(fitHeightDistance, fitWidthDistance) + finalSize.z * 0.8;

    previewCamera.position.set(finalSize.x * 0.05, finalSize.y * 0.1, Math.max(distance, 6));
    previewControls.target.set(0, 0, 0);
    previewCamera.near = Math.max(0.01, distance / 200);
    previewCamera.far = Math.max(500, distance * 20);
    previewCamera.updateProjectionMatrix();
}

function ensureGltfLoaderLoaded() {
    if (!THREE.GLTFLoader) {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
        document.head.appendChild(s);
    }
}

async function loadGLTF(url) {
    ensureGltfLoaderLoaded();
    return new Promise((resolve, reject) => {
        const check = () => {
            if (THREE.GLTFLoader) {
                const loader = new THREE.GLTFLoader();
                loader.load(url, (gltf) => resolve(gltf.scene || gltf.scenes?.[0]), undefined, async (err) => {
                    try {
                        const res = await fetch(url);
                        if (!res.ok) throw err;
                        const blob = await res.blob();
                        const objectUrl = URL.createObjectURL(blob);
                        loader.load(objectUrl, (g) => {
                            URL.revokeObjectURL(objectUrl);
                            resolve(g.scene || g.scenes?.[0]);
                        }, undefined, (e2) => {
                            URL.revokeObjectURL(objectUrl);
                            reject(e2);
                        });
                    } catch (e) {
                        reject(err);
                    }
                });
            } else {
                setTimeout(check, 50);
            }
        };
        check();
    });
}

async function loadModelForName(name, items) {
    clearModel();
    const item = items.find((m) => m.name === name);
    if (!item) return;
    previewModel = await loadGLTF(item.url);

    if (!previewModel) return;

    previewModel.position.set(0, 0, 0);
    previewModel.rotation.set(0, 0, 0);
    previewModel.scale.set(1, 1, 1);

    ensureMaterial(previewModel);
    fixGeometry(previewModel);
    robustCenterAndScale(previewModel);
    previewModel.rotation.set(0, 0, 0);
    previewModel.updateMatrixWorld(true);

    if (previewControls) {
        previewControls.target.set(0, 0, 0);
        previewControls.update();
    }

    previewScene.add(previewModel);
}

async function bootstrap() {
    initPreview();
    const [items, count] = await Promise.all([fetchGltfModels(), fetchReviewCount()]);
    reviewCountEl.textContent = count;

    const names = items.map((m) => m.name).sort();
    modelSelect.innerHTML = names.map((n) => `<option value=\"${n}\">${n}</option>`).join('');

    if (names.length) {
        await loadModelForName(names[0], items);
    }

    modelSelect.addEventListener('change', async (e) => {
        await loadModelForName(e.target.value, items);
    });

    reviewBtn.addEventListener('click', async () => {
        reviewBtn.disabled = true;
        reviewBtn.textContent = 'Convertendo...';
        try {
            const res = await fetch('/api/convert', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Falha na conversão');
            const updated = await fetchGltfModels();
            const names2 = updated.map((m) => m.name).sort();
            modelSelect.innerHTML = names2.map((n) => `<option value=\"${n}\">${n}</option>`).join('');
            if (names2.length) await loadModelForName(names2[0], updated);
            reviewCountEl.textContent = await fetchReviewCount();
        } catch (e) {
            alert('Erro ao converter modelos. Veja o console.');
            console.error(e);
        } finally {
            reviewBtn.disabled = false;
            reviewBtn.textContent = `Modelos de revisão (${reviewCountEl.textContent})`;
        }
    });
}

window.addEventListener('resize', () => {
    if (previewCamera && previewRenderer) {
        previewCamera.aspect = previewContainer.clientWidth / previewContainer.clientHeight;
        previewCamera.updateProjectionMatrix();
        previewRenderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
    }
});

bootstrap();