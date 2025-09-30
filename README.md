# Geolocation Game - Hitta platsen!

A multiplayer geolocation game based on the hitta repository, where players take photos with AI object detection and challenge each other to find the exact location.

## 🎮 Play the Game

**Live Demo**: https://selenwall.github.io/locate/

## Game Rules

1. **Photo Capture**: One player takes a photo of objects at their current location
2. **AI Detection**: The YOLO model identifies objects in the photo (shown in live view)
3. **Challenge**: The identified objects are sent to the other player via messaging
4. **Location Hunt**: The other player has 3 minutes to get within 5 meters of the photo location
5. **Scoring**: 
   - 3 points if found within 1 minute
   - 2 points if found within 2 minutes  
   - 1 point if found within 3 minutes

## Features

- **Same UI/UX as hitta**: Dark theme, modern design, Swedish translations
- **YOLO Object Detection**: Real-time object identification with live camera overlay
- **Geolocation Tracking**: GPS-based proximity detection (5-meter accuracy)
- **Messaging System**: Share game challenges via SMS, WhatsApp, or native sharing
- **Timer & Scoring**: 3-minute countdown with time-based scoring system
- **Swedish Translation**: All object labels translated to Swedish using LibreTranslate

## Technical Requirements

- Modern web browser with camera and location permissions
- Internet connection for AI models and translation
- GPS-enabled device for location tracking

## How to Play

1. Open https://selenwall.github.io/locate/ in a web browser
2. Allow camera and location permissions when prompted
3. Enter player names and select number of rounds
4. Player A takes a photo of objects at their location
5. AI identifies objects and creates a challenge message
6. Share the challenge with Player B
7. Player B opens the link and tries to find the location within 3 minutes
8. Players alternate taking photos and hunting locations

## Files

- `index.html` - Main HTML structure
- `styles.css` - Styling (based on hitta repository)
- `app.js` - Complete game logic with geolocation and AI
- `README.md` - This documentation

## Dependencies

- TensorFlow.js for AI model loading
- ML5.js for YOLO object detection
- COCO-SSD as fallback model
- LibreTranslate API for Swedish translations

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari (iOS 11+)
- Requires HTTPS for camera and location access

## Privacy

- No data is stored on external servers
- Game state is managed via URL parameters
- Location data is only used for proximity calculation
- Camera access is only used for object detection