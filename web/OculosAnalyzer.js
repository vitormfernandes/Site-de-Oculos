const tryOnBtn = document.getElementById('tryOnBtn');
const videoElement = document.getElementById('webcam');
const preview3DContainer = document.getElementById('preview-3d');
const overlayCanvas = document.getElementById('overlay-canvas');
const debugCanvas = document.getElementById('debug-canvas');
const debugCtx = debugCanvas.getContext('2d');

let tryOnActive = false;
let overlayScene, overlayCamera, overlayRenderer, glassesModel;
let isFaceDetectedFirstTime = false;
let areMarkersVisible = false;
let areGlassesVisible = false;
let isModelLoaded = false;

const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});
faceMesh.setOptions({
    maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
});

function onFaceResults(results) {
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        if (tryOnActive && !isFaceDetectedFirstTime) {
            isFaceDetectedFirstTime = true;
            areMarkersVisible = true;
            setTimeout(() => {
                areMarkersVisible = false;
                areGlassesVisible = true;
                tryShowGlasses();
            }, 1500);
        }
        drawEyeMarkers(landmarks);
        drawNoseMarker(landmarks);
        positionGlasses(landmarks);
    }
    if (overlayRenderer) {
        overlayRenderer.render(overlayScene, overlayCamera);
    }
}
faceMesh.onResults(onFaceResults);

function tryShowGlasses() {
    if (areGlassesVisible && isModelLoaded && glassesModel) {
        glassesModel.visible = true;
    }
}

function drawEyeMarkers(landmarks) {
    if (!areMarkersVisible) return;
    const leftEye = landmarks[33], rightEye = landmarks[263];
    const leftX = (1 - leftEye.x) * debugCanvas.width, leftY = leftEye.y * debugCanvas.height;
    const rightX = (1 - rightEye.x) * debugCanvas.width, rightY = rightEye.y * debugCanvas.height;
    debugCtx.fillStyle = 'cyan';
    debugCtx.beginPath(); debugCtx.arc(leftX, leftY, 3, 0, 2 * Math.PI); debugCtx.fill();
    debugCtx.beginPath(); debugCtx.arc(rightX, rightY, 3, 0, 2 * Math.PI); debugCtx.fill();
}

function drawNoseMarker(landmarks) {
    if (!areMarkersVisible) return;
    const noseTip = landmarks[1];
    const noseX = (1 - noseTip.x) * debugCanvas.width, noseY = noseTip.y * debugCanvas.height;
    debugCtx.fillStyle = 'orange';
    debugCtx.beginPath(); debugCtx.arc(noseX, noseY, 3, 0, 2 * Math.PI); debugCtx.fill();
}

function positionGlasses(landmarks) {
    if (!glassesModel || !glassesModel.visible) return;
    const leftEye = landmarks[33], rightEye = landmarks[263];
    const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
    const eyeDistance = Math.sqrt(Math.pow(leftEye.x - rightEye.x, 2) + Math.pow(leftEye.y - rightEye.y, 2));
    const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    glassesModel.position.x = (1 - eyeCenter.x - 0.5) * 100;
    glassesModel.position.y = -(eyeCenter.y - 0.5) * 80;
    const scale = eyeDistance * 380;
    glassesModel.scale.set(scale, scale, scale);
    glassesModel.rotation.z = -angle;
}

tryOnBtn.addEventListener('click', async () => {
    if (tryOnActive) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        videoElement.srcObject = stream;
        videoElement.style.display = 'block';
        preview3DContainer.style.display = 'none';
        tryOnActive = true;
        tryOnBtn.textContent = "Provador Ativo";
        tryOnBtn.disabled = true;
        videoElement.addEventListener('loadedmetadata', () => {
            videoElement.play();
            debugCanvas.width = videoElement.videoWidth;
            debugCanvas.height = videoElement.videoHeight;
            overlayCanvas.width = videoElement.videoWidth;
            overlayCanvas.height = videoElement.videoHeight;
            setupThreeJsOverlay();
            sendVideoToMediaPipe();
        });
    } catch (err) {
        console.error("ERRO AO ACESSAR A CÂMERA:", err);
        alert("Não foi possível acessar a câmera.");
    }
});

async function sendVideoToMediaPipe() {
    if (!tryOnActive) return;
    await faceMesh.send({ image: videoElement });
    requestAnimationFrame(sendVideoToMediaPipe);
}

function setupThreeJsOverlay() {
    overlayScene = new THREE.Scene();
    overlayCamera = new THREE.OrthographicCamera(overlayCanvas.width / -2, overlayCanvas.width / 2, overlayCanvas.height / 2, overlayCanvas.height / -2, 1, 1000);
    overlayCamera.position.z = 500;
    overlayRenderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, alpha: true });
    overlayRenderer.setSize(overlayCanvas.width, overlayCanvas.height);
    overlayRenderer.setClearColor(0x000000, 0);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    overlayScene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 1, 1);
    overlayScene.add(directionalLight);
    const loader = new THREE.STLLoader();
    const modelToLoad = `/assets/Modelos_Oculos/${currentModelFile}`;
    loader.load(modelToLoad, (geometry) => {
        const material = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.1 });
        geometry.center();
        glassesModel = new THREE.Mesh(geometry, material);
        glassesModel.visible = false;
        overlayScene.add(glassesModel);
        isModelLoaded = true;
        tryShowGlasses();
    });
}