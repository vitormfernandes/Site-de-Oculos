let previewScene, previewCamera, previewRenderer, previewModel, previewControls;
const previewContainer = document.getElementById('preview-3d');
const loader = new THREE.STLLoader();

// Variável global para que OculosAnalyzer.js saiba qual modelo usar
let currentModelFile = 'oculos1.stl'; 

function loadModel(modelFile) {
    if (previewModel) {
        previewScene.remove(previewModel);
    }
    loader.load(
        `/assets/Modelos_Oculos/${modelFile}`,
        (geometry) => {
            const material = new THREE.MeshStandardMaterial({
                color: 0x808080, metalness: 0.9, roughness: 0.2
            });
            previewModel = new THREE.Mesh(geometry, material);
            
            geometry.center();
            const box = new THREE.Box3().setFromObject(previewModel);
            const size = box.getSize(new THREE.Vector3()).length();
            const scale = 25 / size;
            previewModel.scale.set(scale, scale, scale);
            
            previewModel.rotation.x = -Math.PI / 12;
            previewModel.rotation.y = Math.PI / 2;

            previewScene.add(previewModel);
        }
    );
}

function initPreview() {
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x000000);

    previewCamera = new THREE.PerspectiveCamera(75, previewContainer.clientWidth / previewContainer.clientHeight, 0.1, 1000);
    previewCamera.position.z = 35;

    previewRenderer = new THREE.WebGLRenderer({ antialias: true });
    previewRenderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
    previewContainer.appendChild(previewRenderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    previewScene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(5, 10, 7.5);
    previewScene.add(directionalLight);
    
    // Carrega o modelo inicial
    loadModel(currentModelFile);

    // CORREÇÃO DEFINITIVA: O erro estava aqui.
    // A variável é 'previewRenderer', e estava escrita incorretamente em versões anteriores,
    // o que impedia o script de continuar e fazia todos os botões falharem.
    previewControls = new THREE.OrbitControls(previewCamera, previewRenderer.domElement);
    previewControls.enableDamping = true;

    function animate() {
        requestAnimationFrame(animate);
        if (previewModel) {
            previewModel.rotation.y += 0.005; 
        }
        previewControls.update();
        previewRenderer.render(previewScene, previewCamera);
    }
    animate();
}

// Lógica do seletor de modelos
const selectorButtons = document.querySelectorAll('.selector-btn');
selectorButtons.forEach(button => {
    button.addEventListener('click', () => {
        selectorButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        currentModelFile = button.dataset.model;
        console.log("Trocando para o modelo:", currentModelFile);
        loadModel(currentModelFile);
    });
});

window.addEventListener('resize', () => {
    if (previewCamera && previewRenderer) {
        previewCamera.aspect = previewContainer.clientWidth / previewContainer.clientHeight;
        previewCamera.updateProjectionMatrix();
        previewRenderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
    }
});

initPreview();