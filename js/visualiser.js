import * as THREE from 'three';
// Import OrbitControls for basic camera interaction during development (optional)
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Global Variables ---

// Core Three.js
let scene, camera, renderer;
let controls; // For OrbitControls (optional)

// Audio
let listener, sound, audioLoader, analyser;
const FFT_SIZE = 1024; // Should match p5.js FFT size for similar analysis results

// Lyrics
let lyrics = [];
let srtLoaded = false;
let currentLyric = null; // Maybe track differently in Three.js

// Animation / Timing
const clock = new THREE.Clock();
// Custom audio playback tracking
let audioStartTimestamp = 0;
let audioPaused = true;
let audioOffset = 0;
let lastPauseTime = 0;

// --- Constants ---
const FONT_SIZE = 50; // Base size for canvas text
const FONT_FACE = 'sans-serif'; // Default font
const LETTER_COLOR = '#FFFFFF'; // Default letter color (can be overridden by SRT parse later)
const LETTER_SPACING_FACTOR = 0.7; // Adjust as needed

// --- Initialization ---
function init() {
    // Scene
    scene = new THREE.Scene();

    // Camera
    const aspect = window.innerWidth / window.innerHeight;
    // Using similar FOV (PI/3 radians is 60 degrees) and near/far planes
    camera = new THREE.PerspectiveCamera(60, aspect, 25, 2000); // Using near=25 from your fix
    // Position based on p5.js setup
    camera.position.set(0, 0, 250);
    camera.lookAt(scene.position); // Look at origin (0,0,0)

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true }); // Keep antialias true!
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('visualizer-container').appendChild(renderer.domElement);

    // Optional: Orbit Controls for Debugging
    // controls = new OrbitControls(camera, renderer.domElement);
    // controls.enableDamping = true;

    // Audio Setup
    listener = new THREE.AudioListener();
    camera.add(listener); // Attach listener to camera
    sound = new THREE.Audio(listener);
    audioLoader = new THREE.AudioLoader();
    analyser = new THREE.AudioAnalyser(sound, FFT_SIZE);

    // Lighting (basic setup, similar to p5)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // Adjust intensity
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Adjust intensity
    directionalLight.position.set(0.5, 0.5, -1); // Example position
    scene.add(directionalLight);

    // Load Assets
    loadAudio('Vessels_Masterv3_4824.mp3');
    loadSRT('lyrics.srt');

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    setupControls();

    // Start Animation Loop
    animate();
}

// --- Loaders ---
function loadAudio(url) {
    audioLoader.load(url, function(buffer) {
        sound.setBuffer(buffer);
        // sound.setLoop(true); // Set if needed
        sound.setVolume(0.5);
        console.log("Audio loaded");
        // Enable play button maybe? Or wait for SRT?
    }, function(xhr) {
        console.log((xhr.loaded / xhr.total * 100) + '% loaded');
    }, function(err) {
        console.error('Error loading audio:', err);
    });
}

async function loadSRT(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const srtContent = await response.text();
        lyrics = parseSRT(srtContent); // Reuse your parsing function
        srtLoaded = true;
        console.log("SRT parsed, found " + lyrics.length + " entries");
        if (lyrics.length > 0) {
            console.log("First lyric start time (ms):", lyrics[0].startTime);
            createLyricObjects(); // Create meshes once lyrics are ready
        }
    } catch (e) {
        console.error("Error loading SRT:", e);
    }
}

// --- SRT Parsing (Reuse your functions) ---
function parseSRT(srtContent) {
    const parsedLyrics = [];
    const blocks = srtContent.trim().split('\n\n');

    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length < 3) continue;

        const timeCode = lines[1];
        const times = timeCode.split(' --> ');
        if (times.length !== 2) continue;

        const startTime = timeToMilliseconds(times[0]);
        const endTime = timeToMilliseconds(times[1]);
        const text = lines.slice(2).join(' ');
        const randomColor = getBrightColor();

        // Add placeholders for Three.js objects
        parsedLyrics.push({
            text: text,
            startTime: startTime,
            endTime: endTime,
            active: false,
            color: randomColor, // Keep color info
            size: THREE.MathUtils.randInt(40, 70), // Keep size info (can influence plane scale)
            // Add properties for Three.js objects
            threeGroup: null, // Will hold THREE.Group for the line
            letterMeshes: [], // Will hold individual letter meshes
            // Add properties for animation targets (similar to p5 version)
            targetX: THREE.MathUtils.randFloat(-150, 150),
            targetY: THREE.MathUtils.randFloat(-100, 100),
            targetZ: THREE.MathUtils.randFloat(-250, -50),
            // Initial position can be target or random (like p5)
            currentX: THREE.MathUtils.randFloat(-150, 150), // Example: Start scattered
            currentY: THREE.MathUtils.randFloat(-100, 100),
            currentZ: THREE.MathUtils.randFloat(-250, -50),
            // Add rotation targets/current if needed
        });
    }
    return parsedLyrics;
}

function timeToMilliseconds(timeString) {
    timeString = timeString.replace(',', '.');
    const parts = timeString.split(/[:.]/); // Split by : or .
    if (parts.length !== 4) return 0;
    const [hours, minutes, seconds, milliseconds] = parts.map(Number);
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}

function getBrightColor() {
    const colors = ["#FF5733", "#33FFF5", "#FFFC33", "#FF33F5", "#33FF57", "#5733FF", "#FF3366", "#66FF33", "#33BBFF", "#FF9933"];
    return colors[Math.floor(Math.random() * colors.length)];
}

// --- Lyric Object Creation (CanvasTexture Approach) ---
function createLyricObjects() {
    lyrics.forEach(lyric => {
        const lineGroup = new THREE.Group();
        lineGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);

        const charArray = lyric.text.split('');
        let currentXOffset = 0;
        const meshes = [];

        // Calculate total width roughly first for centering
        let totalWidth = 0;
        charArray.forEach(char => {
            if (char === ' ') {
                totalWidth += FONT_SIZE * LETTER_SPACING_FACTOR * 0.5; // Space width
            } else {
                totalWidth += FONT_SIZE * LETTER_SPACING_FACTOR; // Estimate letter width
            }
        });
        currentXOffset = -totalWidth / 2;

        charArray.forEach((char, index) => {
            if (char === ' ') {
                // Just advance the offset for spaces
                currentXOffset += FONT_SIZE * LETTER_SPACING_FACTOR * 0.5;
                return;
            }

            const { mesh, width: charWidth } = createLetterMesh(char, FONT_SIZE, lyric.color); // Use lyric.size? Maybe adjust later

            // Position letter relative to the group center
            mesh.position.x = currentXOffset + charWidth / 2;
            // mesh.position.y = 0; // Set animation target later
            // mesh.position.z = 0; // Set animation target later

            // Store initial random positions relative to group for scatter effect
            mesh.userData.initialX = THREE.MathUtils.randFloat(-100, 100);
            mesh.userData.initialY = THREE.MathUtils.randFloat(-200, 200);
            mesh.userData.initialZ = THREE.MathUtils.randFloat(-300, -100);
            mesh.position.set(mesh.userData.initialX, mesh.userData.initialY, mesh.userData.initialZ);

            // Store animation targets relative to group
            mesh.userData.targetX = currentXOffset + charWidth / 2;
            mesh.userData.targetY = 0;
            mesh.userData.targetZ = 0; // Add Z offset later if needed for Z-fighting

            // Add initial rotation if needed
            mesh.rotation.set(
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2
            );
            mesh.userData.targetRotX = 0;
            mesh.userData.targetRotY = 0;
            mesh.userData.targetRotZ = 0;


            lineGroup.add(mesh);
            meshes.push(mesh);

            currentXOffset += charWidth; // Advance offset by character width
        });

        lyric.threeGroup = lineGroup;
        lyric.letterMeshes = meshes;
        lineGroup.visible = false; // Start invisible
        scene.add(lineGroup);
    });
    console.log("Created Three.js objects for lyrics.");
}

function createLetterMesh(char, size, color = LETTER_COLOR) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${size}px ${FONT_FACE}`;
    ctx.font = font;

    // Measure text
    const metrics = ctx.measureText(char);
    let textWidth = metrics.width;
    // Canvas texture sizing - make slightly larger than text, power of 2 often preferred but not strictly necessary
    const canvasWidth = THREE.MathUtils.ceilPowerOfTwo(textWidth + size * 0.2); // Add padding
    const canvasHeight = THREE.MathUtils.ceilPowerOfTwo(size * 1.2); // Estimate height
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Redraw text centered on resized canvas
    ctx.font = font; // Set font again after resize
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, canvasWidth / 2, canvasHeight / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Geometry - Use plane size based on canvas aspect ratio or text metrics
    const planeHeight = size * 1.0; // Match font size roughly
    const planeWidth = planeHeight * (canvasWidth / canvasHeight);
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

    // Material
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff, // Let texture provide color
        transparent: true,
        // alphaTest: 0.1, // Discard fully transparent pixels
        side: THREE.DoubleSide, // Render both sides
        depthWrite: true // Important for correct depth sorting if overlapping! Adjust if needed.
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Return mesh and its calculated width for spacing
    return { mesh, width: planeWidth };
}


// --- Controls ---
function setupControls() {
    const playButton = document.getElementById('play-btn');
    const pauseButton = document.getElementById('pause-btn');

    // Make the event listener async to use await
    playButton.addEventListener('click', async () => {
        try {
            // 1. Ensure AudioContext is running (await its resumption)
            if (listener.context.state === 'suspended') {
                console.log("AudioContext suspended, attempting resume...");
                await listener.context.resume(); // *** IMPORTANT: Wait here ***
                console.log("AudioContext resumed, state:", listener.context.state);
            }

            // 2. Check if sound buffer is loaded AND context is now running
            if (sound && sound.buffer && listener.context.state === 'running') {

                if (!sound.isPlaying) {
                    // 3. Calculate start offset (jumping to first lyric)
                    const firstLyricStartTimeMs = lyrics[0]?.startTime ?? 0; // Default to 0 if no lyrics
                    
                    // Initialize our custom audio tracking
                    audioOffset = firstLyricStartTimeMs / 1000.0;
                    
                    // Set offset in Three.js audio
                    sound.offset = audioOffset;
                    
                    // Play the sound
                    sound.play();
                    
                    // Record the play timestamp and set paused state
                    audioStartTimestamp = performance.now() / 1000;
                    audioPaused = false;
                    
                    console.log(`Playing from offset: ${audioOffset.toFixed(3)}s, timestamp: ${audioStartTimestamp.toFixed(3)}s`);
                } else {
                    console.log("Audio already playing.");
                }

            } else if (!sound.buffer) {
                console.error("Play clicked, but sound buffer not ready.");
            } else if (listener.context.state !== 'running') {
                console.error("Play clicked, but AudioContext is not running.");
            }
        } catch (err) {
            console.error("Error during play button click:", err);
        }
    }); // End playButton listener

    pauseButton.addEventListener('click', () => {
        if (sound && sound.isPlaying) {
            // Record the current playback time before pausing
            const currentPlaybackTime = getCurrentPlaybackTime();
            
            // Pause the audio
            sound.pause();
            
            // Update our tracking variables
            audioOffset = currentPlaybackTime;
            lastPauseTime = performance.now() / 1000;
            audioPaused = true;
            
            console.log("Paused at offset:", audioOffset);
        }
    });
} // End setupControls

// Custom function to get accurate playback time
function getCurrentPlaybackTime() {
    if (audioPaused) {
        return audioOffset; // Return the stored offset when paused
    } else {
        // Calculate current time based on when we started playing plus the initial offset
        const elapsedSinceStart = (performance.now() / 1000) - audioStartTimestamp;
        return audioOffset + elapsedSinceStart;
    }
}

// --- Update & Animation ---

function updateActiveLyricsThreeJS(currentTimeSeconds) {
    const currentTimeMs = currentTimeSeconds * 1000;
    const fadeInTime = 150;
    const fadeOutTime = 150;

    lyrics.forEach(lyric => {
        const wasActive = lyric.active;
        const isInFadeInZone = (currentTimeMs >= lyric.startTime - fadeInTime && currentTimeMs < lyric.startTime);
        const isInActiveZone = (currentTimeMs >= lyric.startTime && currentTimeMs <= lyric.endTime);
        const isInFadeOutZone = (currentTimeMs > lyric.endTime && currentTimeMs <= lyric.endTime + fadeOutTime);

        lyric.active = isInFadeInZone || isInActiveZone || isInFadeOutZone;

        if (lyric.threeGroup) {
            lyric.threeGroup.visible = lyric.active; // Make group visible/invisible
        }

        if (lyric.active && !wasActive) {
            // Reset positions/rotations for dramatic entrance effect? Or let lerp handle it?
            // Option 1: Reset scatter (like p5 version)
            /*
            lyric.letterMeshes.forEach(mesh => {
                mesh.position.set(mesh.userData.initialX, mesh.userData.initialY, mesh.userData.initialZ);
                 mesh.rotation.set(
                    Math.random() * Math.PI * 2,
                    Math.random() * Math.PI * 2,
                    Math.random() * Math.PI * 2
                 );
            });
            */
           // Option 2: Just ensure lerp targets are set (handled in animate loop)
           // Set new group target position on activation
           lyric.targetX = THREE.MathUtils.randFloat(-150, 150);
           lyric.targetY = THREE.MathUtils.randFloat(-100, 100);
           lyric.targetZ = THREE.MathUtils.randFloat(-250, -50);
        }
    });
}


function animate() {
    requestAnimationFrame(animate); // The render loop

    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    let audioLevel = 0;
    let bass = 0, mid = 0, treble = 0;

    if (analyser && sound.isPlaying) {
        const freqData = analyser.getFrequencyData(); // Array of byte values (0-255)

        // Approximate p5.js getEnergy ranges (adjust indices based on FFT_SIZE)
        const bassEnd = Math.floor(FFT_SIZE * 0.1); // ~0-100 Hz if sample rate is 44100/48000
        const midEnd = Math.floor(FFT_SIZE * 0.4); // ~100-1kHz
        const trebleEnd = Math.floor(FFT_SIZE / 2); // Upper half (nyquist)

        let bassSum = 0;
        for (let i = 1; i < bassEnd; i++) bassSum += freqData[i]; // Skip DC offset (index 0)
        bass = (bassSum / (bassEnd - 1) / 255.0) * 2.0; // Normalize and scale up a bit

        let midSum = 0;
        for (let i = bassEnd; i < midEnd; i++) midSum += freqData[i];
        mid = (midSum / (midEnd - bassEnd) / 255.0) * 2.0; // Normalize and scale

        let trebleSum = 0;
        for (let i = midEnd; i < trebleEnd; i++) trebleSum += freqData[i];
        treble = (trebleSum / (trebleEnd - midEnd) / 255.0) * 2.0; // Normalize and scale

        audioLevel = (analyser.getAverageFrequency() / 255.0); // Or calculate based on bass/mid/treble

        // Get the current playback time using our custom tracking function
        const playbackTime = getCurrentPlaybackTime();
        
        // Log current playback time (less frequently to avoid console spam)
        if (Math.floor(playbackTime * 10) % 10 === 0) {
            console.log(`Current Playback Time: ${playbackTime.toFixed(3)}s`);
        }
        
        // Update active lyrics based on our custom playback time
        updateActiveLyricsThreeJS(playbackTime);
    } else {
        // Preview mode animation?
        audioLevel = Math.sin(elapsedTime * 2) * 0.5 + 0.5; // Simple pulse
        bass = mid = treble = audioLevel; // Link them for preview
        // Activate first lyric for preview
        if (lyrics.length > 0) {
             lyrics.forEach((lyric, i) => lyric.active = (i === 0));
             if(lyrics[0].threeGroup) lyrics[0].threeGroup.visible = true;
        }
    }

    // --- Update objects ---
    lyrics.forEach(lyric => {
        if (lyric.active && lyric.threeGroup) {
            // Lerp group position
            lyric.currentX = THREE.MathUtils.lerp(lyric.currentX, lyric.targetX, 0.05);
            lyric.currentY = THREE.MathUtils.lerp(lyric.currentY, lyric.targetY, 0.05);
            lyric.currentZ = THREE.MathUtils.lerp(lyric.currentZ, lyric.targetZ, 0.05);
            lyric.threeGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);
            // Add group rotation sway? (Like p5 version)

            // Update individual letters within the group
            lyric.letterMeshes.forEach((mesh, index) => {
                // --- Adapt updateLetterPositions logic here ---
                // Example: Lerp towards target position relative to group
                const moveSpeed = 0.08; // Adjust speed
                mesh.position.lerp(new THREE.Vector3(mesh.userData.targetX, mesh.userData.targetY, mesh.userData.targetZ), moveSpeed);

                // Example: Lerp rotation back to target (usually 0,0,0)
                const rotSpeed = 0.1;
                 // Use Quaternions for smoother rotation lerping
                 const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(mesh.userData.targetRotX, mesh.userData.targetRotY, mesh.userData.targetRotZ));
                 mesh.quaternion.slerp(targetQuaternion, rotSpeed);


                // --- Adapt drawLetter3D reactive logic here ---
                // Example: Scale based on audio/mouse
                let baseScale = 1.0;
                // let sizeMod = calculateSizeMod(letter.char, bass, mid, treble); // Adapt from p5
                // let pulseFactor = 1 + Math.sin(elapsedTime * 5 + index * 0.5) * 0.05 * audioLevel;
                // mesh.scale.setScalar(baseScale * sizeMod * pulseFactor);

                 // Example: Update color? (More complex - needs vertex colors or changing material)
            });
        }
    });

    // --- Update camera ---
    // Adapt updateCamera logic from p5 to modify Three.js camera.position/lookAt
    // updateCameraThreeJS(audioLevel, elapsedTime);


    // --- Render ---
    // For now, render directly to screen. Post-processing comes next.
    renderer.render(scene, camera);

    // Optional: Update OrbitControls if used
    // controls.update();
}

// --- Event Handlers ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Run ---
init();