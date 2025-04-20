import * as THREE from 'three';
// Import OrbitControls for basic camera interaction during development (optional)
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// Import post-processing modules
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- Global Variables ---

// Core Three.js
let scene, camera, renderer;

// Post-Processing
let renderTargetA, renderTargetB; // For ping-pong feedback
let feedbackShader, glitchShader; // Shader materials
let quadScene, quadCamera; // For rendering full-screen quads
let feedbackQuad, outputQuad; // Full-screen quads for effects
const resolutionScale = 0.75; // OPTIMIZATION: Lower value (e.g., 0.5) = more performance, less quality

// Audio
let listener, sound, audioLoader, analyser;
const FFT_SIZE = 1024;

// Lyrics
let lyrics = [];
let srtLoaded = false;

// Animation / Timing
const clock = new THREE.Clock();
let audioStartTimestamp = 0;
let audioPaused = true;
let audioOffset = 0;

// Mouse/Touch Interaction
let mouseX = 0;
let mouseY = 0;
let targetMouseX = 0;
let targetMouseY = 0;
let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;
let isInteracting = false;
let touchStartX = 0;
let touchStartY = 0;

let averageActiveLyricZ = -150; // Default Z, will be updated each frame
const raycaster = new THREE.Raycaster();
const mouse3D = new THREE.Vector2(); 
const mousePlaneZ = -100; 
const mouseWorldPosition = new THREE.Vector3(); 

let viewportWorldWidth = 0;
let viewportWorldHeight = 0;
let aspectRatio = 1;

// --- Shader Paths (ADJUST THESE TO YOUR ACTUAL FILES) ---
const FEEDBACK_VERTEX_PATH = '/shaders/feedback.vert.glsl';
const FEEDBACK_FRAGMENT_PATH = '/shaders/feedback.frag.glsl';
const GLITCH_VERTEX_PATH = '/shaders/glitch.vert.glsl';
const GLITCH_FRAGMENT_PATH = '/shaders/glitch.frag.glsl';
/* * OPTIMIZATION NOTE: Consider adding `precision mediump float;` 
* at the top of feedback.frag.glsl and glitch.frag.glsl 
* if high precision isn't strictly required. 
*/

// --- Constants ---
const FONT_SIZE = 50; 
let FONT_FACE = 'sans-serif'; 
const FONT_FILE_PATH = 'Blackout Midnight.ttf'; 
const FONT_FAMILY_NAME = 'Blackout Midnight'; 
const LETTER_COLOR = '#FFFFFF'; 
const LETTER_SPACING_FACTOR = 0.1; 
const STROKE_WIDTH = 8; 
const STROKE_COLOR = 'red'; 
let customFontLoaded = false;

// --- OPTIMIZATION: Reusable temporary objects for loops ---
const _tempVec3 = new THREE.Vector3();
const _tempVec3_b = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler();


// --- Utility Functions ---

function updateMouse3DPosition(event) { // Takes the event, uses global averageActiveLyricZ
    if (!camera) return; // Need camera

    mouse3D.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse3D.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse3D, camera);

    // *** FIX: Use averageActiveLyricZ for the interaction plane ***
    const planeZ = averageActiveLyricZ; // Target the average depth of active lyrics
    const planeNormal = _tempVec3.set(0, 0, 1); // Reuse temp vector
    const planeConstant = -planeZ; // Plane equation constant d = -Z when normal is (0,0,1)
    const plane = new THREE.Plane(planeNormal, planeConstant);

    // Optional Debug Log: Check the plane's depth
    // if (clock.elapsedTime % 1.0 < 0.017) { // Log roughly once per second
    //      console.log(`Mouse Interaction Plane Z: ${planeZ.toFixed(1)}, Camera Z: ${camera.position.z.toFixed(1)}`);
    // }

    // Find intersection with this new plane
    raycaster.ray.intersectPlane(plane, mouseWorldPosition);

    // Fallback if intersection fails (e.g., ray parallel to plane)
    if (!mouseWorldPosition || isNaN(mouseWorldPosition.x)) {
       // Simple fallback: Place point on the plane near origin
       mouseWorldPosition.set(0, 0, planeZ); 
    }
}

function updateViewportDimensions() {
    if (!camera) return;
    const fov = camera.fov * (Math.PI / 180);
    const zDepth = -150; 
    const distance = Math.abs(zDepth - camera.position.z);
    viewportWorldHeight = 2 * Math.tan(fov / 2) * distance;
    aspectRatio = window.innerWidth / window.innerHeight;
    viewportWorldWidth = viewportWorldHeight * aspectRatio;
}

function getWorldPositionFromPercent(xPercent, yPercent, zDepth) {
    const worldX = (xPercent * viewportWorldWidth) / 2;
    const worldY = (yPercent * viewportWorldHeight) / 2;
    return { x: worldX, y: worldY, z: zDepth };
}

function randomPositionInViewport(
    xMinPercent = -0.3, xMaxPercent = 0.3,
    yMinPercent = -0.3, yMaxPercent = 0.3,
    zMinDepth = -250, zMaxDepth = -50
) {
    const xPercent = THREE.MathUtils.randFloat(xMinPercent, xMaxPercent);
    const yPercent = THREE.MathUtils.randFloat(yMinPercent, yMaxPercent);
    const zDepth = THREE.MathUtils.randFloat(zMinDepth, zMaxDepth);
    return getWorldPositionFromPercent(xPercent, yPercent, zDepth);
}

function timeToMilliseconds(timeString) {
    timeString = timeString.replace(',', '.');
    const parts = timeString.split(/[:.]/);
    if (parts.length !== 4) return 0;
    const [hours, minutes, seconds, milliseconds] = parts.map(Number);
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}

function getBrightColor() {
    const colors = ["#FF5733", "#33FFF5", "#FFFC33", "#FF33F5", "#33FF57", "#5733FF", "#FF3366", "#66FF33", "#33BBFF", "#FF9933"];
    return colors[Math.floor(Math.random() * colors.length)];
}

function getCurrentPlaybackTime() {
    if (audioPaused) {
        return audioOffset;
    } else {
        const elapsedSinceStart = (performance.now() / 1000) - audioStartTimestamp;
        return Math.max(audioOffset, audioOffset + elapsedSinceStart);
    }
}

// --- Interaction Setup ---
function setupInteraction() {
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('mouseup', onDocumentMouseUp);
    document.addEventListener('touchstart', onDocumentTouchStart, { passive: false });
    document.addEventListener('touchmove', onDocumentTouchMove, { passive: false });
    document.addEventListener('touchend', onDocumentTouchEnd);
    console.log("Mouse/touch interaction setup complete");
}

function onDocumentMouseMove(event) {
    targetMouseX = (event.clientX - windowHalfX); 
    targetMouseY = (event.clientY - windowHalfY);
    updateMouse3DPosition(event);
}

function onDocumentMouseDown(event) {
    isInteracting = true;
    touchStartX = event.clientX - windowHalfX;
    touchStartY = event.clientY - windowHalfY;
    targetMouseX = touchStartX;
    targetMouseY = touchStartY;
    mouseX = targetMouseX; 
    mouseY = targetMouseY;
}

function onDocumentMouseUp() {
    isInteracting = false;
}

function onDocumentTouchStart(event) {
    if (event.touches.length === 1) {
        event.preventDefault();
        isInteracting = true;
        touchStartX = event.touches[0].pageX - windowHalfX;
        touchStartY = event.touches[0].pageY - windowHalfY;
        targetMouseX = touchStartX;
        targetMouseY = touchStartY;
        mouseX = targetMouseX; 
        mouseY = targetMouseY;
        updateMouse3DPosition({ clientX: event.touches[0].pageX, clientY: event.touches[0].pageY });
    }
}

function onDocumentTouchMove(event) {
    if (event.touches.length === 1) {
        event.preventDefault();
        const touchX = event.touches[0].pageX - windowHalfX;
        const touchY = event.touches[0].pageY - windowHalfY;
        targetMouseX = touchX;
        targetMouseY = touchY;
        updateMouse3DPosition({ clientX: event.touches[0].pageX, clientY: event.touches[0].pageY });
    }
}

function onDocumentTouchEnd() {
    isInteracting = false;
}

// --- Font Loading ---
async function loadCustomFont() {
    try {
        console.log(`Loading custom font from: ${FONT_FILE_PATH}`);
        const encodedFontFileName = encodeURIComponent(FONT_FILE_PATH); 
        const fontFace = new FontFace(
            FONT_FAMILY_NAME,
            `url('${encodedFontFileName}') format('truetype')` 
        );
        const loadedFont = await fontFace.load();
        document.fonts.add(loadedFont);
        FONT_FACE = FONT_FAMILY_NAME; 
        customFontLoaded = true;
        console.log(`Custom font "${FONT_FAMILY_NAME}" loaded successfully`);
        return true;
    } catch (error) {
        console.error('Error loading custom font:', error);
        console.log('Falling back to default font:', FONT_FACE);
        return false;
    }
}

// --- Shader Loading ---
async function loadShader(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        }
        return await response.text();
    } catch (e) {
        console.error(`Failed to load shader: ${url}`, e);
        if (url.includes('.vert')) {
            return `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
        } else {
            return `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`;
        }
    }
}

async function loadShaders() {
    console.log("Loading shaders...");
    const [feedbackVS, feedbackFS, glitchVS, glitchFS] = await Promise.all([
        loadShader(FEEDBACK_VERTEX_PATH),
        loadShader(FEEDBACK_FRAGMENT_PATH),
        loadShader(GLITCH_VERTEX_PATH),
        loadShader(GLITCH_FRAGMENT_PATH)
    ]);
    console.log("Shaders loaded.");
    return { feedbackVS, feedbackFS, glitchVS, glitchFS };
}

// --- Audio Setup & Controls ---
function setupAudio() {
    return new Promise((resolve, reject) => { 
        listener = new THREE.AudioListener();
        camera.add(listener); 
        sound = new THREE.Audio(listener);
        audioLoader = new THREE.AudioLoader();

        audioLoader.load('Vessels_Masterv3_4824.mp3',
            buffer => {
                sound.setBuffer(buffer);
                sound.setVolume(0.5);
                analyser = new THREE.AudioAnalyser(sound, FFT_SIZE);
                console.log("Audio loaded and analyzer created");
                resolve(buffer); 
            },
            progress => { console.log(`Audio loading: ${Math.round(progress.loaded / progress.total * 100)}%`); },
            error => { console.error('Error loading audio:', error); reject(error); }
        );
    });
}

function setupControls() {
    const playButton = document.getElementById('play-btn');
    const pauseButton = document.getElementById('pause-btn');

    async function handlePlayAudio() {
        try {
            // console.log("Play button pressed, context state:", listener.context.state);
            if (listener.context.state === 'suspended') {
                await listener.context.resume();
                // console.log("AudioContext resumed.");
            }
            if (sound && sound.buffer && listener.context.state === 'running') {
                if (!sound.isPlaying) {
                    sound.offset = audioOffset; 
                    sound.play();
                    audioStartTimestamp = performance.now() / 1000 - audioOffset; 
                    audioPaused = false;
                    // console.log(`Playing audio: offset=${audioOffset.toFixed(3)}s, timestamp=${audioStartTimestamp.toFixed(3)}s`);
                }
            } else { console.warn("Cannot play audio - check sound buffer and context state"); }
        } catch (err) { console.error("Error in handlePlayAudio:", err); }
    }

    function handlePauseAudio() {
        try {
            if (sound && sound.isPlaying) {
                audioOffset = getCurrentPlaybackTime(); 
                sound.pause(); 
                audioPaused = true;
                // console.log("Paused at offset:", audioOffset.toFixed(3));
            } else { console.warn("Cannot pause: sound is not playing."); }
        } catch (err) { console.error("Error during pause:", err); }
    }

    playButton.addEventListener('click', handlePlayAudio);
    playButton.addEventListener('touchend', (e) => { e.preventDefault(); handlePlayAudio(); });
    pauseButton.addEventListener('click', handlePauseAudio);
    pauseButton.addEventListener('touchend', (e) => { e.preventDefault(); handlePauseAudio(); });

    setupiOSAudioUnlock();
}

function setupiOSAudioUnlock() {
    // console.log("Setting up iOS audio unlock handlers");
    const unlockAudio = async () => {
        if (!listener || !listener.context || listener.context.state !== 'suspended') return; 
        try {
            await listener.context.resume();
            // console.log("Audio context unlocked via user gesture.");
            const buffer = listener.context.createBuffer(1, 1, 22050);
            const source = listener.context.createBufferSource();
            source.buffer = buffer;
            source.connect(listener.context.destination);
            source.start(0);
            source.stop(listener.context.currentTime + 0.001);
        } catch (error) { console.error("Failed to unlock audio context:", error); }
    };
    document.addEventListener('pointerdown', unlockAudio, { once: true }); 
}

// --- Initialization ---
async function init() {
    console.log("init() called");
    scene = new THREE.Scene();
    aspectRatio = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspectRatio, 1, 2000); 
    camera.position.set(0, 0, 250); 
    camera.lookAt(scene.position);
    updateViewportDimensions(); 
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;

    await loadCustomFont(); 

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false; 
    document.getElementById('visualizer-container').appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9); directionalLight.position.set(0.5, 1, -0.5); scene.add(directionalLight);

    setupInteraction(); 

    console.log("Starting asset loading...");
    const [shadersResult, audioResult, srtResult] = await Promise.allSettled([
        loadShaders(), setupAudio(), 
        fetch('lyrics.srt').then(res => { if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`); return res.text(); })
    ]);

    let shaderCode;
    if (shadersResult.status === 'fulfilled') { shaderCode = shadersResult.value; } 
    else { console.error("FATAL: Failed to load shaders!", shadersResult.reason); return; }

    if (audioResult.status === 'fulfilled') { console.log("Audio setup completed successfully."); } 
    else { console.error('Audio setup failed:', audioResult.reason); }

    if (srtResult.status === 'fulfilled') {
        lyrics = parseSRT(srtResult.value); srtLoaded = true;
        createLyricObjects(); 
    } else { console.error("Error loading or parsing SRT:", srtResult.reason); }
    console.log("Asset loading finished.");

    setupPostProcessing(shaderCode); 
    setupControls(); 
    window.addEventListener('resize', onWindowResize);
    console.log("Starting animation loop...");
    animate();
}

// --- Post-Processing Setup ---
function setupPostProcessing(shaderCode) {
    console.log("Setting up ping-pong feedback post-processing...");
    const targetOptions = { 
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, 
        format: THREE.RGBAFormat, type: THREE.UnsignedByteType, stencilBuffer: false
    };
    
    const pixelRatio = renderer.getPixelRatio();
    // *** OPTIMIZATION: Apply resolution scale factor ***
    const width = Math.floor(window.innerWidth * pixelRatio * resolutionScale);
    const height = Math.floor(window.innerHeight * pixelRatio * resolutionScale);
    
    console.log(`Setting post-processing resolution to: ${width}x${height} (Scale: ${resolutionScale})`);

    renderTargetA = new THREE.WebGLRenderTarget(width, height, targetOptions);
    renderTargetB = new THREE.WebGLRenderTarget(width, height, targetOptions);
    
    quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quadScene = new THREE.Scene();
    
    feedbackShader = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, prevFrame: { value: null }, feedbackAmount: { value: 0.95 }, time: { value: 0.0 }, audioLevel: { value: 0.0 } },
        vertexShader: shaderCode.feedbackVS, fragmentShader: shaderCode.feedbackFS, depthTest: false, depthWrite: false
    });
    glitchShader = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, intensity: { value: 0.1 }, time: { value: 0.0 }, audioLevel: { value: 0.0 } },
        vertexShader: shaderCode.glitchVS, fragmentShader: shaderCode.glitchFS, depthTest: false, depthWrite: false
    });
    
    feedbackQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), feedbackShader);
    outputQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glitchShader);
    
    console.log("Post-processing setup complete.");
}

// --- SRT Parsing (with Line Splitting, Corrected Stacking, and Split Flag) ---
function parseSRT(srtContent) {
    const parsedLyrics = []; 
    const blocks = srtContent.trim().split('\n\n'); 

    const MAX_LINE_LENGTH = 10; 
    const LINE_STACKING_OFFSET = FONT_SIZE * 1.1; // Increased offset

    for (const block of blocks) {
        const lines = block.split('\n'); 
        if (lines.length < 3) continue; 
        const timeCode = lines[1]; 
        const times = timeCode.split(' --> '); 
        if (times.length !== 2) continue; 
        const startTime = timeToMilliseconds(times[0]); 
        const endTime = timeToMilliseconds(times[1]);   
        const originalText = lines.slice(2).join(' '); 
        const randomColor = getBrightColor(); 

        let textParts = [originalText]; 
        let wasSplit = false; // Flag for split lines

        // Line Splitting Logic
        if (originalText.length > MAX_LINE_LENGTH) {
            let remainingText = originalText; let potentialParts = []; let safetyBreak = 0; 
            while (remainingText.length > MAX_LINE_LENGTH && safetyBreak < 5) { 
                 safetyBreak++; let splitIndex = -1; const idealSplitPoint = MAX_LINE_LENGTH; const searchRadius = 10; 
                 for (let i = idealSplitPoint; i >= idealSplitPoint - searchRadius && i > 0; i--) { if (remainingText[i] === ' ') { splitIndex = i; break; } }
                 if (splitIndex === -1) { for (let i = idealSplitPoint + 1; i < idealSplitPoint + searchRadius && i < remainingText.length; i++) { if (remainingText[i] === ' ') { splitIndex = i; break; } } }
                 if (splitIndex === -1) { splitIndex = MAX_LINE_LENGTH; }
                 potentialParts.push(remainingText.substring(0, splitIndex).trim()); remainingText = remainingText.substring(splitIndex).trim();
                 if (remainingText.length <= MAX_LINE_LENGTH) { potentialParts.push(remainingText); remainingText = ""; break; }
            } 
            if(remainingText.length > 0) { potentialParts.push(remainingText); }
            if (potentialParts.length > 1) { textParts = potentialParts; wasSplit = true; }
        } // End Splitting Logic

        const partCount = textParts.length; 
        const baseInitialPos = randomPositionInViewport(-0.2, 0.2, -0.15, 0.15, -180, -90);
        const totalHeight = (partCount - 1) * LINE_STACKING_OFFSET;
        const topTargetY = baseInitialPos.y + totalHeight / 2; 

        textParts.forEach((textPart, index) => {
            const lineTargetY = topTargetY - (index * LINE_STACKING_OFFSET);
            // console.log(`Creating lyric part ${index}: Text="${textPart.substring(0,10)}...", TargetY=${lineTargetY.toFixed(2)}`); // Keep for debug if needed
            parsedLyrics.push({
                id: `${startTime}_${index}`, text: textPart, startTime: startTime, endTime: endTime, active: false, color: randomColor, size: FONT_SIZE, 
                threeGroup: null, letterMeshes: [], 
                targetX: baseInitialPos.x, targetY: lineTargetY, targetZ: baseInitialPos.z,
                currentX: baseInitialPos.x, currentY: lineTargetY, currentZ: baseInitialPos.z - 50, 
                baseScale: 1.0, wasSplit: wasSplit, // Store the flag
                disposed: false, inactiveTimestamp: null,    
            });
        }); 
    } 
    console.log(`Parsed ${blocks.length} SRT blocks into ${parsedLyrics.length} lyric objects.`);
    return parsedLyrics; 
}


// --- Lyric Object Creation & Cleanup ---
function createLyricObjects() {
    // console.log(`Creating lyric objects with font: ${FONT_FACE}`);
    updateViewportDimensions(); 

    lyrics.forEach(lyric => {
        if (lyric.disposed || lyric.threeGroup) return; 

        const lineGroup = new THREE.Group();
        lineGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ); 
        
        const charArray = lyric.text.split('');
        let currentXOffset = 0; const meshes = []; let totalWidth = 0;
        const spaceWidth = lyric.size * LETTER_SPACING_FACTOR * 0.5;
        const letterMeshObjects = [];

        charArray.forEach(char => {
            if (char === ' ') { totalWidth += spaceWidth; } 
            else { const letterObj = createLetterMesh(char, lyric.size, lyric.color); letterMeshObjects.push(letterObj); totalWidth += letterObj.width; }
        });
        totalWidth += Math.max(0, charArray.length - 1) * (lyric.size * LETTER_SPACING_FACTOR * 0.3);
        
        const maxAllowedWidth = viewportWorldWidth * 0.95; let scaleFactor = 1.0;
        if (totalWidth > 0 && totalWidth > maxAllowedWidth) { scaleFactor = maxAllowedWidth / totalWidth; }
        lyric.baseScale = scaleFactor; 
        lineGroup.scale.set(lyric.baseScale, lyric.baseScale, lyric.baseScale);

        currentXOffset = -totalWidth / 2; let letterIndex = 0;
        charArray.forEach((char, index) => {
            if (char === ' ') { currentXOffset += spaceWidth; return; }
            const { mesh, width: charWidth } = letterMeshObjects[letterIndex++];
            mesh.userData.targetX = currentXOffset + (charWidth / 2); mesh.userData.targetY = 0; mesh.userData.targetZ = index * 0.01; 
            const initialOffsetMagnitude = 30; 
            const randomDirection = _tempVec3.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(initialOffsetMagnitude);
            mesh.userData.initialX = mesh.userData.targetX + randomDirection.x; mesh.userData.initialY = mesh.userData.targetY + randomDirection.y; mesh.userData.initialZ = mesh.userData.targetZ + randomDirection.z + 60; 
            mesh.position.set(mesh.userData.initialX, mesh.userData.initialY, mesh.userData.initialZ);
            mesh.userData.targetRotX = 0; mesh.userData.targetRotY = 0; mesh.userData.targetRotZ = 0;
            mesh.rotation.set(THREE.MathUtils.randFloatSpread(Math.PI * 0.5), THREE.MathUtils.randFloatSpread(Math.PI * 0.5), THREE.MathUtils.randFloatSpread(Math.PI * 0.25));
            lineGroup.add(mesh); meshes.push(mesh);
            currentXOffset += charWidth + (lyric.size * LETTER_SPACING_FACTOR * 0.3);
        });
        
        lyric.threeGroup = lineGroup; lyric.letterMeshes = meshes;
        lineGroup.visible = false; scene.add(lineGroup); 
    });
}

function createLetterMesh(char, size, color = LETTER_COLOR) {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    const font = `${size}px ${FONT_FACE}`; ctx.font = font;
    const metrics = ctx.measureText(char); const textWidth = metrics.width; const padding = STROKE_WIDTH * 2; 
    const canvasWidth = THREE.MathUtils.ceilPowerOfTwo(textWidth + padding); const fontHeightEstimate = size * 1.2; 
    const canvasHeight = THREE.MathUtils.ceilPowerOfTwo(fontHeightEstimate + padding);
    canvas.width = canvasWidth; canvas.height = canvasHeight;
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const centerX = canvasWidth / 2; const centerY = canvasHeight / 2;
    ctx.strokeStyle = STROKE_COLOR; ctx.lineWidth = STROKE_WIDTH; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    ctx.strokeText(char, centerX, centerY); // Stroke first
    ctx.fillStyle = color; ctx.fillText(char, centerX, centerY); // Fill on top
    const texture = new THREE.CanvasTexture(canvas); texture.needsUpdate = true; texture.minFilter = THREE.LinearFilter;
    const planeHeight = size * (canvasHeight / fontHeightEstimate); const planeWidth = planeHeight * (canvasWidth / canvasHeight); 
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide, depthWrite: true }); // Maybe depthWrite: false? Test visually.
    const mesh = new THREE.Mesh(geometry, material);
    return { mesh, width: textWidth }; 
}

function cleanupLyric(lyric) {
    if (!lyric || !lyric.threeGroup || lyric.disposed) return; 
    // console.log(`Cleaning up lyric (ID ${lyric.id}): "${lyric.text.substring(0, 20)}..."`);
    lyric.letterMeshes.forEach(mesh => {
        lyric.threeGroup.remove(mesh); 
        if (mesh.geometry) { mesh.geometry.dispose(); }
        if (mesh.material) {
            // *** OPTIMIZATION: Ensure texture map disposal ***
            if (mesh.material.map instanceof THREE.Texture) { 
                mesh.material.map.dispose(); 
            }
            mesh.material.dispose();
        }
    });
    lyric.letterMeshes = []; 
    scene.remove(lyric.threeGroup); 
    lyric.threeGroup = null; 
    lyric.disposed = true; 
    lyric.inactiveTimestamp = null;
}

// --- Update Logic (Handles Visibility, Targets, and Cleanup Trigger) ---
function updateActiveLyricsThreeJS(currentTimeSeconds) {
    const currentTimeMs = currentTimeSeconds * 1000;
    const fadeInTime = 150; const fadeOutTime = 150; const cleanupDelay = 5000; 

    lyrics.forEach(lyric => {
        if (lyric.disposed) return; 
        const wasActive = lyric.active; 
        const isInFadeInZone = (currentTimeMs >= lyric.startTime - fadeInTime && currentTimeMs < lyric.startTime);
        const isInActiveZone = (currentTimeMs >= lyric.startTime && currentTimeMs <= lyric.endTime);
        const isInFadeOutZone = (currentTimeMs > lyric.endTime && currentTimeMs <= lyric.endTime + fadeOutTime);
        lyric.active = isInFadeInZone || isInActiveZone || isInFadeOutZone;
        if (lyric.threeGroup) { lyric.threeGroup.visible = lyric.active; }
        
        // When a lyric *just* becomes active 
        if (lyric.active && !wasActive) {
            const newPos = randomPositionInViewport(-0.2, 0.2, -0.15, 0.15, -180, -90);
            lyric.targetX = newPos.x; lyric.targetZ = newPos.z;
            // *** FIX: Only update Y if it was *not* part of a split line ***
            if (!lyric.wasSplit) { lyric.targetY = newPos.y; } 
            // Set initial Current position slightly away from target
            lyric.currentX = lyric.targetX + (Math.random() - 0.5) * 10; 
            lyric.currentY = lyric.wasSplit ? lyric.targetY : lyric.targetY + (Math.random() - 0.5) * 10; 
            lyric.currentZ = lyric.targetZ - 30; 
            if(lyric.threeGroup) { lyric.threeGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ); }
        } 

        // Cleanup Logic Trigger
        if (!lyric.active && wasActive && lyric.threeGroup) { lyric.inactiveTimestamp = performance.now(); }
        if (!lyric.active && lyric.inactiveTimestamp && (performance.now() - lyric.inactiveTimestamp > cleanupDelay)) { cleanupLyric(lyric); }
    }); 
}


function applyLetterScaling(letterMesh, audioLevel, baseScale = 1.0) {
    // --- Reverted Optimization: Use Local Vectors for Debugging ---
    const localTempVecA = new THREE.Vector3(); 
    const localTempVecB = new THREE.Vector3();
    // --- End Reverted Optimization ---

    if (!letterMesh || !letterMesh.parent) return;
    // Ensure world matrix is up-to-date before getting world position
    letterMesh.updateWorldMatrix(true, false); 

    // Use a local temporary vector to store the letter's position
    const letterPosition = localTempVecB; // Use local vector B
    letterMesh.getWorldPosition(letterPosition); 
    
    // Basic safety check for valid positions
    if (isNaN(mouseWorldPosition.x) || isNaN(letterPosition.x)) {
        // console.warn("Invalid position detected in applyLetterScaling"); // Optional warning
        return; 
    }

    // Use squared distance for initial check (more performant)
    const distanceSq = letterPosition.distanceToSquared(mouseWorldPosition); 
    const maxDistance = 150; // The range of the scaling effect
    const maxDistanceSq = maxDistance * maxDistance; // Compare squared distances
    
    // Define how much the scale changes with audio and distance
    // NOTE: You had 4.6 here in the last paste, reverting to 1.6 for testing baseline
    const maxScaleFactor = 2.6 + audioLevel * 0.6;  // Max relative scale boost
    const minScaleFactor = 0.7;  // Min relative scale reduction
    
    let dynamicScaleFactor;
    if (distanceSq < maxDistanceSq) {
        // Calculate distance only if needed for the easing function
        const distance = Math.sqrt(distanceSq); 
        // Calculate easing factor (t goes from 1 at distance 0 to 0 at maxDistance)
        const t = 1 - (distance / maxDistance);
        // Apply ease-out quadratic curve (t*t)
        dynamicScaleFactor = minScaleFactor + (maxScaleFactor - minScaleFactor) * t * t; 
    } else {
        // If outside maxDistance, use the minimum scale factor
        dynamicScaleFactor = minScaleFactor; 
    }

    // Combine the base scale (for clipping) with the dynamic scale (mouse/audio interaction)
    const finalScale = baseScale * dynamicScaleFactor;

    // Use a local temporary vector for the target scale
    const targetScaleVec = localTempVecA; // Use local vector A
    targetScaleVec.set(finalScale, finalScale, finalScale); // Set its components
    
    // Safety check for NaN before lerping (can happen with extreme values)
    if (!isNaN(targetScaleVec.x)) {
       // Lerp the mesh's current scale towards the calculated target scale
       letterMesh.scale.lerp(targetScaleVec, 0.15); // Adjust lerp factor (0.1 to 0.2) for desired smoothness
    } else {
       // Fallback: If calculation resulted in NaN, lerp towards the base scale
       const fallbackScaleVec = localTempVecA; // Reuse local vector A
       fallbackScaleVec.set(baseScale, baseScale, baseScale);
       letterMesh.scale.lerp(fallbackScaleVec, 0.15);
       // console.warn("NaN detected in target scale, using baseScale fallback."); // Optional warning
    }
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();
    const currentPlaybackTime = getCurrentPlaybackTime();

    // --- Calculate Average Active Lyric Z ---
    let activeZSum = 0;
    let activeCount = 0;
    lyrics.forEach(lyric => {
        // Consider only lyrics that are active and not yet cleaned up
        if (lyric.active && !lyric.disposed) {
            // Use targetZ as it's the intended final position for this appearance
            activeZSum += lyric.targetZ; 
            activeCount++;
        }
    });
    // Calculate average or reset to default if no lyrics are active
    if (activeCount > 0) {
        averageActiveLyricZ = activeZSum / activeCount;
    } else {
        averageActiveLyricZ = -150; // Default depth if no lyrics active
    }
    // --- End Average Z Calculation ---


    let audioLevel = 0, bass = 0, mid = 0, treble = 0;
    // Update lyric active state (doesn't depend on avg Z)
    updateActiveLyricsThreeJS(currentPlaybackTime); 

    // Audio Analysis
    if (analyser && (sound.isPlaying || !audioPaused)) {
        // ... (audio analysis code remains the same) ...
         const freqData = analyser.getFrequencyData();
         const bassEnd = Math.floor(FFT_SIZE * 0.08); const midEnd = Math.floor(FFT_SIZE * 0.3); const trebleEnd = Math.floor(FFT_SIZE * 0.5); 
         let bassSum = 0; for (let i = 1; i < bassEnd; i++) bassSum += freqData[i]; bass = (bassSum / (bassEnd - 1 || 1) / 255.0) * 1.5; 
         let midSum = 0; for (let i = bassEnd; i < midEnd; i++) midSum += freqData[i]; mid = (midSum / (midEnd - bassEnd || 1) / 255.0) * 1.5;
         let trebleSum = 0; for (let i = midEnd; i < trebleEnd; i++) trebleSum += freqData[i]; treble = (trebleSum / (trebleEnd - midEnd || 1) / 255.0) * 1.5;
         audioLevel = Math.min(1.0, (Math.max(bass, mid, treble) * 0.6 + (analyser.getAverageFrequency() / 255.0) * 0.4) * 1.2);
    } else { 
        audioLevel = Math.abs(Math.sin(elapsedTime * 1.5)) * 0.6; bass = mid = treble = audioLevel;
    }

    // Update Camera
    updateCamera(deltaTime, audioLevel, bass, elapsedTime);

    // --- Update visible lyric objects ---
    lyrics.forEach(lyric => {
        if (lyric.active && lyric.threeGroup && !lyric.disposed) { 
            // ... (Group position lerp remains the same) ...
             const groupMoveSpeed = 0.06; 
             lyric.currentX = THREE.MathUtils.lerp(lyric.currentX, lyric.targetX, groupMoveSpeed);
             lyric.currentY = THREE.MathUtils.lerp(lyric.currentY, lyric.targetY, groupMoveSpeed);
             lyric.currentZ = THREE.MathUtils.lerp(lyric.currentZ, lyric.targetZ, groupMoveSpeed);
             lyric.threeGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);

            // Update individual letters
            lyric.letterMeshes.forEach((mesh) => {
                // ... (Letter position/rotation lerp remains the same using _temp vars) ...
                 const letterMoveSpeed = 0.15; const letterRotSpeed = 0.15; 
                 mesh.position.lerp( _tempVec3.set(mesh.userData.targetX, mesh.userData.targetY, mesh.userData.targetZ), letterMoveSpeed );
                 _tempEuler.set(mesh.userData.targetRotX, mesh.userData.targetRotY, mesh.userData.targetZ);
                 _tempQuat.setFromEuler(_tempEuler); 
                 mesh.quaternion.slerp(_tempQuat, letterRotSpeed);

                // *** Call applyLetterScaling *** // It now implicitly uses the updated mouseWorldPosition which is based on averageActiveLyricZ
                applyLetterScaling(mesh, audioLevel, lyric.baseScale); 
            });
        }
    }); // --- End lyric update loop ---

    // === PING-PONG RENDERING ===
    if (!renderer || !renderTargetA || !renderTargetB || !feedbackShader || !glitchShader || !quadScene || !quadCamera) return; // Sanity check
    
    // STEP 1: Render main scene to Target A
    renderer.setRenderTarget(renderTargetA); renderer.clear(); renderer.render(scene, camera);
    
    // STEP 2: Prepare Feedback Pass
    feedbackShader.uniforms.tDiffuse.value = renderTargetA.texture; feedbackShader.uniforms.prevFrame.value = renderTargetB.texture; 
    feedbackShader.uniforms.time.value = elapsedTime; feedbackShader.uniforms.audioLevel.value = audioLevel;
    feedbackShader.uniforms.feedbackAmount.value = THREE.MathUtils.lerp(0.40, 0.97, audioLevel * 0.8); 

    // STEP 3: Render Feedback Effect to a Temporary Target
    const tempTarget = renderTargetA.clone(); // Avoid direct reuse if possible, cloning ensures size/format match
    quadScene.clear(); quadScene.add(feedbackQuad); 
    renderer.setRenderTarget(tempTarget); renderer.clear(); renderer.render(quadScene, quadCamera);
    
    // STEP 4: Prepare Glitch Pass
    glitchShader.uniforms.tDiffuse.value = tempTarget.texture; glitchShader.uniforms.time.value = elapsedTime; glitchShader.uniforms.audioLevel.value = audioLevel;
    glitchShader.uniforms.intensity.value = THREE.MathUtils.lerp(0.05, 0.2, audioLevel); 
    
    // STEP 5: Render Glitch Effect to the Screen
    quadScene.clear(); quadScene.add(outputQuad); 
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(quadScene, quadCamera);
    
    // STEP 6: Copy the feedback result (from tempTarget) to Target B for the *next* frame
    // OPTIMIZATION: Reuse a single copy material/quad if possible (create outside loop)
    // For simplicity here, creating temporary ones each frame (minor overhead)
    const copyMaterial = new THREE.MeshBasicMaterial({ map: tempTarget.texture });
    const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
    quadScene.clear(); quadScene.add(copyQuad);
    renderer.setRenderTarget(renderTargetB); renderer.clear(); renderer.render(quadScene, quadCamera);
    
    // STEP 7: Cleanup temporary resources
    renderer.setRenderTarget(null); 
    tempTarget.dispose(); 
    copyMaterial.map = null; copyMaterial.dispose(); 
    // copyQuad geometry is cheap, managed by THREE normally
}

// --- Camera Update ---
function updateCamera(deltaTime, audioLevel, bassLevel, elapsedTime) { // Include elapsedTime
    const baseDistance = 250; 
    const audioDistanceFactor = (bassLevel * 0.6 + audioLevel * 0.4) * 60; 
    const targetDistance = baseDistance - audioDistanceFactor;
    // Use temporary vector for lerp target
    camera.position.lerp( _tempVec3.copy(camera.position).normalize().multiplyScalar(targetDistance), 0.08 );

    let targetX = 0; let targetY = 0;
    if (isInteracting) { targetX = targetMouseX; targetY = targetMouseY; } 
    else { const time = elapsedTime * 0.5; targetX = Math.sin(time * 0.6) * windowHalfX * 0.1; targetY = Math.cos(time * 0.4) * windowHalfY * 0.1; }

    const lerpFactor = isInteracting ? 0.15 : 0.04; 
    mouseX = THREE.MathUtils.lerp(mouseX, targetX, lerpFactor); mouseY = THREE.MathUtils.lerp(mouseY, targetY, lerpFactor);

    const rotationSensitivity = 0.0025; 
    const horizontalAngle = -mouseX * rotationSensitivity; const verticalAngle = -mouseY * rotationSensitivity; 
    const maxVerticalAngle = Math.PI * 0.45; 
    const clampedVerticalAngle = THREE.MathUtils.clamp(verticalAngle, -maxVerticalAngle, maxVerticalAngle);
    const currentDistance = camera.position.length(); 
    // Reuse temporary vector for position calculation
    const position = _tempVec3; 
    position.x = currentDistance * Math.sin(horizontalAngle) * Math.cos(clampedVerticalAngle);
    position.y = currentDistance * Math.sin(clampedVerticalAngle);
    position.z = currentDistance * Math.cos(horizontalAngle) * Math.cos(clampedVerticalAngle);
    camera.position.copy(position);
    camera.lookAt(0, 0, 0); // Use origin as target vector (0,0,0)
}


// --- Event Handlers ---
function onWindowResize() {
    const width = window.innerWidth; const height = window.innerHeight;
    windowHalfX = width / 2; windowHalfY = height / 2;
    camera.aspect = width / height; camera.updateProjectionMatrix();
    updateViewportDimensions(); // Update world dimensions

    // *** OPTIMIZATION: Apply same resolution scale here ***
    const pixelRatio = renderer.getPixelRatio();
    const targetWidth = Math.floor(width * pixelRatio * resolutionScale);
    const targetHeight = Math.floor(height * pixelRatio * resolutionScale);

    renderer.setSize(width, height); // Renderer still uses full size

    // Resize post-processing targets to scaled resolution
    renderTargetA?.setSize(targetWidth, targetHeight);
    renderTargetB?.setSize(targetWidth, targetHeight);
}

// --- Run ---
init().catch(err => { 
    console.error("Initialization failed:", err);
    const container = document.getElementById('visualizer-container');
    if (container) { container.innerHTML = `<p style="color: red; padding: 20px;">Error initializing visualizer. Please check console for details.</p>`; }
});