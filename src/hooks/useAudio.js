import { useState, useRef, useEffect } from 'react';

const useAudio = () => {
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('day-planner-sound-enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const audioCtxRef = useRef(null);

  // Persist soundEnabled to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-sound-enabled', JSON.stringify(soundEnabled));
  }, [soundEnabled]);

  const getAudioCtx = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playFocusSound = (type) => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (type === 'work') {
        // Ascending chime: C5 → E5
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(659, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else if (type === 'break') {
        // Descending chime: E5 → C5
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(523, ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      } else if (type === 'complete') {
        // Staggered chord: C5 + E5 + G5
        [523, 659, 784].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
          gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + i * 0.1 + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.1);
          osc.stop(ctx.currentTime + 0.8);
        });
      }
    } catch (e) { /* Audio API not available */ }
  };

  const playUISound = (type) => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;
      switch (type) {
        case 'pop': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, now);
          osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
          osc.frequency.exponentialRampToValueAtTime(600, now + 0.12);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        }
        case 'swoosh': {
          // Two-note descending motif (E5 → B4)
          [659, 494].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.12, now + i * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.1);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.09);
            osc.stop(now + i * 0.09 + 0.1);
          });
          break;
        }
        case 'slide': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(500, now);
          osc.frequency.exponentialRampToValueAtTime(300, now + 0.2);
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.25);
          break;
        }
        case 'drop': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(150, now);
          osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        }
        case 'tick': {
          // Subtle clock-tick: short noise impulse through a tight bandpass
          const bufferSize = Math.floor(ctx.sampleRate * 0.015);
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.value = 3000;
          filter.Q.value = 5;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
          noise.connect(filter).connect(gain).connect(ctx.destination);
          noise.start(now);
          noise.stop(now + 0.02);
          break;
        }
        case 'crumple': {
          const bufferSize = ctx.sampleRate * 0.2;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(2000, now);
          filter.frequency.exponentialRampToValueAtTime(400, now + 0.2);
          filter.Q.value = 1;
          noise.connect(filter).connect(gain).connect(ctx.destination);
          noise.start(now);
          noise.stop(now + 0.2);
          break;
        }
        case 'click': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.value = 1000;
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.04);
          break;
        }
        case 'spotlight': {
          // Soft rising shimmer — two quick sine tones (G5 → B5)
          [784, 988].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, now + i * 0.07);
            gain.gain.linearRampToValueAtTime(0.1, now + i * 0.07 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.12);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.07);
            osc.stop(now + i * 0.07 + 0.12);
          });
          break;
        }
        case 'restore': {
          // Quick ascending pop: low → high, like something bouncing back up
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(300, now);
          osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        }
        case 'undo': {
          // Quick ascending blip — reverse feel of swoosh
          [494, 659].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.12, now + i * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.1);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.09);
            osc.stop(now + i * 0.09 + 0.1);
          });
          break;
        }
        case 'reminder': {
          // Ascending triad C5→E5→G5 with longer sustain
          [523, 659, 784].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, now + i * 0.15);
            gain.gain.linearRampToValueAtTime(0.18, now + i * 0.15 + 0.05);
            gain.gain.setValueAtTime(0.18, now + i * 0.15 + 0.25);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.6);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.15);
            osc.stop(now + i * 0.15 + 0.6);
          });
          break;
        }
        case 'error': {
          // Short double-buzz: two quick low-frequency oscillations
          [150, 120].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.12, now + i * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.1);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.12);
            osc.stop(now + i * 0.12 + 0.1);
          });
          break;
        }
      }
    } catch (e) { /* Audio API not available */ }
  };

  return { soundEnabled, setSoundEnabled, playUISound, playFocusSound };
};

export default useAudio;
