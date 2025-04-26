/**
 * script.js for Gesture Rock Paper Scissors Game
 * Includes: MediaPipe Hands setup, Camera handling, Gesture classification,
 * Game logic, UI updates, Countdown timer, Simultaneous reveal, Reset functionality.
 * Uses .jpeg image paths as previously requested.
 * Sound effects are enabled but may be subject to browser autoplay restrictions.
 */

// --- DOM Element References ---
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const loadingMessage = document.getElementById('loading-message');
const gameArea = document.getElementById('game-area');
const playerGestureIcon = document.getElementById('player-gesture-icon');
const computerGestureIcon = document.getElementById('computer-gesture-icon');
const playerDetectedGestureText = document.getElementById('player-detected-gesture');
const computerChosenGestureText = document.getElementById('computer-chosen-gesture');
const resultMessage = document.getElementById('result-message');
const playerScoreDisplay = document.getElementById('player-score');
const computerScoreDisplay = document.getElementById('computer-score');
const playAgainButton = document.getElementById('play-again');
const countdownElement = document.getElementById('countdown');
const detectionIndicator = document.getElementById('detection-indicator');
const debugInfo = document.getElementById('debug-info'); // Optional for debugging

// --- Configuration ---
const GESTURES = ['rock', 'paper', 'scissors'];
// *** Ensure these paths match your files (using .jpeg as requested) ***
const GESTURE_ICONS = {
    rock: 'icons/rock.jpeg',
    paper: 'icons/paper.jpeg',
    scissors: 'icons/scissors.jpeg',
    unknown: 'icons/unknown.jpeg' // Make sure you have an unknown.jpeg
};
const DETECTION_CONFIDENCE = 0.7; // Base confidence threshold for MediaPipe (adjust in setOptions)
const GESTURE_LOCK_THRESHOLD = 15; // Frames needed to lock gesture before countdown (Increased slightly for stability)
const COUNTDOWN_SECONDS = 3;

// --- Game State Variables ---
let playerScore = 0;
let computerScore = 0;
let currentDetectedGesture = null; // The gesture currently being detected/held
let gestureLocked = false;         // Flag: True only AFTER countdown finishes successfully
let consecutiveFrames = 0;       // Counter for stable gesture detection
let countdownTimer = null;         // Stores the setInterval ID for the countdown
let gameInProgress = false;        // Flag: True during countdown and result display (prevents new detections)
let handPresence = false;          // Flag: True if a hand is detected in the frame
let lastProcessedGesture = null;   // Helps stabilize detection against minor flickering

// --- MediaPipe Hands Setup ---
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 1,             // Process only the first detected hand
    modelComplexity: 1,         // 0=fastest, 1=balanced, 2=most accurate
    minDetectionConfidence: 0.6,// Minimum confidence for initial hand detection (Adjust if needed)
    minTrackingConfidence: 0.6 // Minimum confidence for tracking hand across frames (Adjust if needed)
});

// Register the callback function for when MediaPipe processes results
hands.onResults(onResults);

// --- Camera Setup ---
const camera = new Camera(videoElement, {
    onFrame: async () => {
        if (!videoElement) return; // Ensure video element exists

        // Match canvas dimensions to the video DISPLAY size for accurate drawing
        // Do this on each frame in case of layout changes, though less critical if fixed size
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;

        // Prepare canvas for drawing (mirroring the webcam view)
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height); // Clear canvas before drawing
        // MediaPipe processes the original video, drawing should be overlaid correctly
        // The mirroring for display is handled by CSS transform on video and canvas
        await hands.send({ image: videoElement });
        canvasCtx.restore();
    },
    width: 640, // Desired camera resolution width
    height: 480 // Desired camera resolution height
});

// --- Initialization Function ---
function initializeGame() {
    console.log("Initializing game...");
    resetUI(); // Start with a clean UI
    playerScore = 0;
    computerScore = 0;
    updateScoreboard(); // Set scores to 0 initially
    loadingMessage.classList.remove('hidden'); // Show loading indicator
    gameArea.classList.add('hidden');         // Hide main game area

    // Start the camera feed
    camera.start()
        .then(() => {
            console.log("Camera started successfully.");
            loadingMessage.classList.add('hidden');    // Hide loading message
            gameArea.classList.remove('hidden'); // Show the game area
            startDetectionCycle();               // Begin looking for hands
        })
        .catch(error => {
            console.error("Failed to start camera:", error);
            loadingMessage.innerHTML = `<p>Error starting camera. Please grant permission and refresh.</p><p style="font-size: 0.8em; color: #ccc;">${error}</p>`;
            loadingMessage.classList.remove('hidden'); // Keep message visible on error
            gameArea.classList.add('hidden');
        });
}

// --- MediaPipe Results Handler ---
function onResults(results) {
    // Update hand presence status and visual indicator FIRST
    handPresence = !!(results.multiHandLandmarks && results.multiHandLandmarks.length > 0);
    updateDetectionIndicator(handPresence);

    // Clear the overlay canvas (drawing is optional)
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    // Optional: Draw Hand Landmarks for Debugging
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
         canvasCtx.scale(-1, 1); // Flip horizontally for drawing mirrored landmarks
         canvasCtx.translate(-canvasElement.width, 0);
         for (const landmarks of results.multiHandLandmarks) {
             // Draw connectors (lines between points)
             drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
             // Draw landmarks (points)
             drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });
         }
    }
    canvasCtx.restore();
    // --- End Optional Debugging Drawing ---


    // --- Core Gesture Detection Logic ---
    // Process only if a hand is present AND the game is not already in progress (countdown/reveal)
    if (handPresence && !gameInProgress) {
        const landmarks = results.multiHandLandmarks[0]; // Get landmarks for the detected hand
        const gesture = classifyGesture(landmarks);      // Attempt to classify the gesture

        // Optional: Display debug info
        // debugInfo.textContent = `Hand: ${handPresence}, Gesture: ${gesture || 'None'}, Frames: ${consecutiveFrames}, Locked: ${gestureLocked}, InProgress: ${gameInProgress}`;

        if (gesture) {
            // Check if the detected gesture is the same as the one we're trying to lock
            if (gesture === currentDetectedGesture) {
                // Same gesture detected consecutively
                consecutiveFrames++;
                playerDetectedGestureText.textContent = `Hold ${capitalize(gesture)}... (${consecutiveFrames}/${GESTURE_LOCK_THRESHOLD})`; // Show progress
            } else {
                // New potential gesture detected
                console.log(`New gesture detected: ${gesture}`);
                currentDetectedGesture = gesture;
                consecutiveFrames = 1; // Reset frame count for the new gesture
                playerDetectedGestureText.textContent = `${capitalize(gesture)} Detected! Hold...`;
                // Keep player icon as 'unknown' until reveal
                playerGestureIcon.src = GESTURE_ICONS.unknown;
                playerGestureIcon.classList.remove('chosen');
            }
            lastProcessedGesture = gesture; // Track the last seen valid gesture

            // Check if the gesture has been held long enough to lock and start the countdown
            if (consecutiveFrames >= GESTURE_LOCK_THRESHOLD && !countdownTimer) {
               playerDetectedGestureText.textContent = `${capitalize(gesture)} Locked!`; // Confirm lock in text
               startCountdown(); // Begin the countdown process
            }

        } else {
            // Hand is present, but the pose doesn't match a known gesture (or classification returned null)
            // Reset if the user shows an invalid gesture, requiring them to show a valid one again.
             if (lastProcessedGesture !== null) { // Only reset if there WAS a gesture being tracked
                console.log("Gesture lost or became unclear.");
                resetDetectionState();
                playerDetectedGestureText.textContent = "Show Rock, Paper, or Scissors";
                playerGestureIcon.src = GESTURE_ICONS.unknown;
                playerGestureIcon.classList.remove('chosen');
                lastProcessedGesture = null; // Clear last processed since it's invalid now
             } else {
                 // If no gesture was being tracked, just prompt
                 playerDetectedGestureText.textContent = "Show Rock, Paper, or Scissors";
             }
        }
    } else if (!handPresence && !gameInProgress) {
        // Hand is not detected, and game is not in progress
        if (currentDetectedGesture || consecutiveFrames > 0) {
            // If we were in the middle of detecting, reset state
            console.log("Hand lost during detection phase.");
            resetDetectionState();
            stopCountdown(); // Ensure countdown stops if hand is removed
            playerDetectedGestureText.textContent = "Show Hand";
            playerGestureIcon.src = GESTURE_ICONS.unknown;
            playerGestureIcon.classList.remove('chosen');
            lastProcessedGesture = null;
        } else {
             // If just waiting, keep the "Show Hand" message
             playerDetectedGestureText.textContent = "Show Hand";
        }
    }
    // If gameInProgress is true, do nothing here - let playGame/resetUI handle state transitions.
}


// --- Gesture Classification Function (Simplified) ---
// This function analyzes hand landmarks to determine the gesture.
// It's a basic implementation using Y-coordinates and might need tuning.
function classifyGesture(landmarks) {
    if (!landmarks || landmarks.length < 21) return null; // Need all 21 landmarks

    // Define landmark indices (more readable)
    const WRIST = 0;
    const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4;
    const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_DIP = 7, INDEX_TIP = 8;
    const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_DIP = 11, MIDDLE_TIP = 12;
    const RING_MCP = 13, RING_PIP = 14, RING_DIP = 15, RING_TIP = 16;
    const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_DIP = 19, PINKY_TIP = 20;

    // --- Helper Functions ---
    // Checks if a finger is likely extended (tip is significantly "above" its base knuckle - lower Y value)
    // Threshold might need tuning based on camera angle/distance.
    const isExtended = (tipIndex, mcpIndex, threshold = 0.06) => {
        return landmarks[tipIndex].y < landmarks[mcpIndex].y - threshold;
    };

    // Checks if a finger is likely curled (tip is "below" or near its base knuckle - higher or similar Y value)
    // Threshold allows for some flexibility in fist shapes.
    const isCurled = (tipIndex, mcpIndex, threshold = 0.02) => {
         return landmarks[tipIndex].y > landmarks[mcpIndex].y - threshold;
    };

    // Get extension status for each finger (excluding thumb initially)
    const indexExtended = isExtended(INDEX_TIP, INDEX_MCP);
    const middleExtended = isExtended(MIDDLE_TIP, MIDDLE_MCP);
    const ringExtended = isExtended(RING_TIP, RING_MCP);
    const pinkyExtended = isExtended(PINKY_TIP, PINKY_MCP);

    // Get curl status for each finger
    const indexCurled = isCurled(INDEX_TIP, INDEX_MCP);
    const middleCurled = isCurled(MIDDLE_TIP, MIDDLE_MCP);
    const ringCurled = isCurled(RING_TIP, RING_MCP);
    const pinkyCurled = isCurled(PINKY_TIP, PINKY_MCP);

    // --- Classification Logic ---

    // PAPER: All 4 main fingers extended. Thumb position less critical but generally out.
    if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
         // Add extra check: Tips should be significantly higher (lower Y) than the wrist for a clear paper gesture
         if (landmarks[INDEX_TIP].y < landmarks[WRIST].y * 0.9 && // Adjust multiplier if needed (closer to 1 means less strict)
             landmarks[MIDDLE_TIP].y < landmarks[WRIST].y * 0.9) {
            // console.log("Classified as PAPER");
            return 'paper';
         }
    }

    // SCISSORS: Index and Middle extended, Ring and Pinky curled.
    if (indexExtended && middleExtended && ringCurled && pinkyCurled) {
        // console.log("Classified as SCISSORS");
        return 'scissors';
    }

    // ROCK: All 4 main fingers curled.
    if (indexCurled && middleCurled && ringCurled && pinkyCurled) {
        // Optional: Check thumb position (e.g., thumb tip close to index finger base/palm center)
        // This helps distinguish from other curled hand shapes.
        const thumbTip = landmarks[THUMB_TIP];
        const indexPip = landmarks[INDEX_PIP]; // Check against index finger middle joint
        const thumbToIndexPipDist = Math.hypot(thumbTip.x - indexPip.x, thumbTip.y - indexPip.y);
        // console.log("Thumb-Index PIP dist:", thumbToIndexPipDist); // Debugging distance
        if (thumbToIndexPipDist < 0.15) { // Threshold for thumb closeness (adjust needed)
             // console.log("Classified as ROCK");
             return 'rock';
        }
    }

    // If none of the above conditions are met confidently
    // console.log("Classification: None");
    return null;
}


// --- Game Logic Functions ---

// Selects a random gesture for the computer
function computerPlay() {
    const randomIndex = Math.floor(Math.random() * GESTURES.length);
    return GESTURES[randomIndex];
}

// Determines the winner based on standard Rock Paper Scissors rules
function determineWinner(playerChoice, computerChoice) {
    if (playerChoice === computerChoice) {
        return 'draw'; // It's a tie
    }
    // Winning conditions for the player
    if (
        (playerChoice === 'rock' && computerChoice === 'scissors') ||
        (playerChoice === 'scissors' && computerChoice === 'paper') ||
        (playerChoice === 'paper' && computerChoice === 'rock')
    ) {
        return 'win';
    }
    // Otherwise, the player loses
    return 'lose';
}

// --- Core Gameplay Function (Called after countdown) ---
// Uses requestAnimationFrame for a smoother simultaneous reveal effect.
function playGame() {
    // Double-check: Should only run if a gesture was successfully locked by the countdown
    if (!currentDetectedGesture || !gestureLocked) {
        console.warn("playGame called without a locked gesture. Resetting state.");
        resetUI(); // Reset if state is inconsistent
        return;
    }

    // Set game state to prevent interference from new detections until "Play Again"
    gameInProgress = true;
    console.log("PlayGame triggered. Determining winner...");

    // Determine choices
    const playerChoice = currentDetectedGesture; // The gesture locked by the countdown
    const computerChoice = computerPlay();

    // --- Step 1: Set BOTH areas to a neutral "Revealing..." state IMMEDIATELY ---
    // This prevents showing the player's final choice before the computer's is ready.
    playerGestureIcon.src = GESTURE_ICONS.unknown;
    computerGestureIcon.src = GESTURE_ICONS.unknown;
    playerDetectedGestureText.textContent = "..."; // Indicate revealing
    computerChosenGestureText.textContent = "..."; // Indicate revealing
    playerGestureIcon.classList.remove('chosen');  // Clear potential highlights
    computerGestureIcon.classList.remove('chosen');
    resultMessage.textContent = "Revealing...";    // Update status message
    resultMessage.className = '';                  // Clear win/lose/draw styling
    countdownElement.textContent = "";             // Clear "Shoot!" text

    // --- Step 2: Use requestAnimationFrame to schedule the FINAL reveal ---
    // This ensures the browser renders the "Revealing..." state above first,
    // then performs the updates below together in the next paint cycle,
    // making the reveal appear simultaneous.
    requestAnimationFrame(() => {
        console.log(`Final Reveal - Player: ${playerChoice}, Computer: ${computerChoice}`);

        // --- Step 3: Update BOTH player and computer visuals to final choices ---
        updatePlayerChoiceUI(playerChoice, true);    // Show player's locked choice with styling
        updateComputerChoiceUI(computerChoice, true); // Show computer's random choice with styling

        // --- Step 4: Determine and display the outcome ---
        const result = determineWinner(playerChoice, computerChoice);
        updateScore(result);                         // Update score variables
        displayResultMessage(result, playerChoice, computerChoice); // Show win/lose/draw message
        playSound(result);                           // Play optional sound effect

        // --- Step 5: Enable playing again ---
        playAgainButton.classList.remove('hidden'); // Show the "Play Again" button

        // gameInProgress remains true until 'Play Again' is clicked, handled by resetUI()
    });
    // --- End of playGame function ---
}


// --- UI Update Functions ---

// Updates the scoreboard display
function updateScoreboard() {
    playerScoreDisplay.textContent = playerScore;
    computerScoreDisplay.textContent = computerScore;
}

// Updates the score variables based on the round result
function updateScore(result) {
    if (result === 'win') {
        playerScore++;
    } else if (result === 'lose') {
        computerScore++;
    }
    updateScoreboard(); // Refresh the scoreboard display
}

// Updates the player's side of the UI (icon, text, highlight)
function updatePlayerChoiceUI(gesture, isFinalChoice) {
    // Use the actual gesture icon only for the final reveal
    playerGestureIcon.src = (isFinalChoice && gesture) ? GESTURE_ICONS[gesture] : GESTURE_ICONS.unknown;
    // Text depends on the state (detecting, holding, final)
    // Simplified here; specific text is handled by onResults, startCountdown, playGame
    playerDetectedGestureText.textContent = (isFinalChoice && gesture) ? capitalize(gesture) : playerDetectedGestureText.textContent; // Keep existing text if not final

    if (isFinalChoice) {
        playerGestureIcon.classList.add('chosen'); // Add highlight/animation class
    } else {
        playerGestureIcon.classList.remove('chosen');
    }
}

// Updates the computer's side of the UI (icon, text, highlight)
function updateComputerChoiceUI(gesture, isFinalChoice) {
     computerGestureIcon.src = (isFinalChoice && gesture) ? GESTURE_ICONS[gesture] : GESTURE_ICONS.unknown;
     computerChosenGestureText.textContent = (isFinalChoice && gesture) ? capitalize(gesture) : "Waiting...";
     if (isFinalChoice) {
        computerGestureIcon.classList.add('chosen'); // Add highlight/animation class
    } else {
        computerGestureIcon.classList.remove('chosen');
    }
}

// Displays the result message (Win, Lose, Draw) with styling
function displayResultMessage(result, playerChoice, computerChoice) {
    let message = "";
    resultMessage.className = ''; // Clear previous result classes

    switch (result) {
        case 'win':
            message = `${capitalize(playerChoice)} beats ${capitalize(computerChoice)}. You Win! 🎉`;
            resultMessage.classList.add('win');
            break;
        case 'lose':
            message = `${capitalize(computerChoice)} beats ${capitalize(playerChoice)}. You Lose! 😢`;
            resultMessage.classList.add('lose');
            break;
        case 'draw':
            message = `It's a Draw! Both chose ${capitalize(playerChoice)}. 🤝`;
            resultMessage.classList.add('draw');
            break;
        default: // Should not happen
             message = "Game Over";
    }
    resultMessage.textContent = message;
}

// Resets the UI and relevant game state variables for a new round
function resetUI() {
    console.log("Resetting UI for new round...");
    gameInProgress = false; // Allow detection to resume
    resultMessage.textContent = "Show your hand to start!";
    resultMessage.className = ''; // Clear result styling
    playAgainButton.classList.add('hidden'); // Hide "Play Again" button

    // Reset player display
    playerGestureIcon.src = GESTURE_ICONS.unknown;
    playerGestureIcon.classList.remove('chosen');
    playerDetectedGestureText.textContent = "Detecting...";

    // Reset computer display
    computerGestureIcon.src = GESTURE_ICONS.unknown;
    computerGestureIcon.classList.remove('chosen');
    computerChosenGestureText.textContent = "Waiting...";

    // Clear countdown text and stop any active timer
    countdownElement.textContent = "";
    stopCountdown();

    // Reset internal detection state variables
    resetDetectionState();
    lastProcessedGesture = null; // Reset last processed gesture
    debugInfo.textContent = ""; // Clear debug info
}

// Resets only the variables related to gesture detection stability
function resetDetectionState() {
     // console.log("Resetting detection state (frames, locked flag, current gesture)");
     gestureLocked = false;
     currentDetectedGesture = null;
     consecutiveFrames = 0;
     // No visual changes here, handled by callers (resetUI or onResults)
}

// Updates the visual indicator for hand detection (red/green dot)
function updateDetectionIndicator(detected) {
    if (detected) {
        if (!detectionIndicator.classList.contains('detected')) {
            detectionIndicator.classList.add('detected'); // Turn green
        }
    } else {
        if (detectionIndicator.classList.contains('detected')) {
            detectionIndicator.classList.remove('detected'); // Turn red (default)
        }
    }
}


// --- Countdown Logic ---
function startCountdown() {
    // Prevent starting multiple countdowns or if no gesture is ready/locked
    if (countdownTimer || !currentDetectedGesture) {
        console.warn("Countdown start prevented: Timer active or no gesture.");
        return;
    }

    console.log(`Starting countdown for gesture: ${currentDetectedGesture}`);
    gameInProgress = true; // Prevent gesture changes DURING countdown
    gestureLocked = false; // Gesture isn't truly locked until countdown COMPLETES successfully

    let secondsLeft = COUNTDOWN_SECONDS;
    countdownElement.textContent = secondsLeft; // Show initial countdown number

    // Update player text to confirm locked gesture during countdown
    playerDetectedGestureText.textContent = `${capitalize(currentDetectedGesture)} Locked! Get Ready...`;
    // Keep player icon as placeholder during countdown visually
    playerGestureIcon.src = GESTURE_ICONS.unknown;
    playerGestureIcon.classList.remove('chosen');
    // Computer waits
    computerChosenGestureText.textContent = "Choosing...";


    // Start the timer interval
    countdownTimer = setInterval(() => {
        secondsLeft--;
        countdownElement.textContent = secondsLeft > 0 ? secondsLeft : "Shoot!"; // Update display

        if (secondsLeft <= 0) {
            // Countdown finished
            stopCountdown(); // Clear the interval FIRST

            // --- Final Check ---
            // Re-verify hand presence and that the intended gesture is still held (or was held until the end)
            // We rely on currentDetectedGesture which was set when countdown started.
            if (currentDetectedGesture && handPresence) {
                 console.log(`Countdown finished. Locking gesture: ${currentDetectedGesture} and playing.`);
                 gestureLocked = true; // NOW the gesture is officially locked for the round
                 playGame();          // Proceed to play the game and reveal choices
            } else {
                 // If hand was lost or something went wrong right at the end
                 console.warn("Hand lost or state error at countdown end. Resetting.");
                 resetUI(); // Reset the game state entirely
            }
        }
    }, 1000); // Timer ticks every 1 second
}

// Clears the countdown interval timer
function stopCountdown() {
    if (countdownTimer) {
        // console.log("Stopping countdown timer.");
        clearInterval(countdownTimer);
        countdownTimer = null;
        // Associated UI text (countdown number) is cleared by playGame or resetUI
    }
}


// --- Utility Functions ---

// Capitalizes the first letter of a string
function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Plays sound effects (optional, check file paths and browser permissions)
function playSound(result) {
    try {
        const sound = document.getElementById(`${result}-sound`);
        if (sound) {
            sound.currentTime = 0; // Rewind before playing
            sound.play().catch(e => {
                // Log warning if autoplay fails - often due to browser policy
                // requiring user interaction first. Clicking "Play Again" counts.
                console.warn(`Audio play failed for '${result}':`, e.message);
            });
        } else {
            console.warn(`Sound element not found for result: ${result}-sound`);
        }
    } catch (error) {
        console.error("Error playing sound:", error);
    }
}

// Function to kick off the detection loop (implicitly done by camera start)
function startDetectionCycle() {
    console.log("Detection cycle active. Waiting for hand...");
    resetUI(); // Ensure UI is in the correct starting state
}

// --- Event Listeners ---

// Handle clicks on the "Play Again" button
playAgainButton.addEventListener('click', () => {
    console.log("Play Again clicked.");
    resetUI(); // Reset the game for a new round
    // Detection will resume automatically via onResults when a hand is shown
});

// --- Start the Application ---

// Wait for the page and resources to be fully loaded before initializing
window.addEventListener('load', () => {
     console.log("Window loaded. Initializing game...");
     // Small delay to ensure elements are fully ready, especially video dimensions
     setTimeout(initializeGame, 100);
});