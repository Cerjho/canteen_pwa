// Notification sound utility using Web Audio API
// This avoids the need for an external audio file

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

export function playNotificationSound(volume: number = 0.5): void {
  try {
    const ctx = getAudioContext();
    
    // Resume context if suspended (required for some browsers)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    // Pleasant notification sound - two-tone beep
    oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5
    oscillator.frequency.setValueAtTime(1109, ctx.currentTime + 0.1); // C#6
    
    oscillator.type = 'sine';
    
    // Fade in and out for a pleasant sound
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume * 0.3, ctx.currentTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(volume * 0.3, ctx.currentTime + 0.1);
    gainNode.gain.linearRampToValueAtTime(volume * 0.4, ctx.currentTime + 0.12);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.25);
  } catch {
    // Silently fail if audio is not supported
    // (Audio context creation may fail in some environments)
  }
}

// Alternative: Create a beep pattern for more urgency
export function playUrgentNotificationSound(volume: number = 0.5): void {
  try {
    const ctx = getAudioContext();
    
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // Play two quick beeps
    [0, 0.15].forEach((delay) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      oscillator.frequency.setValueAtTime(1000, ctx.currentTime + delay);
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0, ctx.currentTime + delay);
      gainNode.gain.linearRampToValueAtTime(volume * 0.3, ctx.currentTime + delay + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + 0.1);
      
      oscillator.start(ctx.currentTime + delay);
      oscillator.stop(ctx.currentTime + delay + 0.1);
    });
  } catch {
    // Silently fail if audio is not supported
  }
}
