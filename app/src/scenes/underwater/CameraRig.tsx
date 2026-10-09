import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { DEMO } from '../../env';
import { HALF, type World } from './world';

interface Props {
  world: World;
  freeSwim: boolean;
  reducedMotion: boolean;
}

/**
 * Camera: a slow, gentle drift along a short spline (a dolly in and out with a little sway and
 * bob) that keeps a composed view: plants or rocks in the foreground, fish in the middle and the
 * slope fading into the haze behind. Free-look by drag or touch. "Free swim" adds WASD + mouse
 * movement (Q/E for down and up). The drift stops under prefers-reduced-motion.
 */
export function CameraRig({ world, freeSwim, reducedMotion }: Props) {
  const { camera, gl } = useThree();
  const st = useRef({
    t: 0,
    offYaw: 0,
    offPitch: 0,
    yaw: 0,
    pitch: 0,
    pos: new Vector3(),
    tmp: new Vector3(),
    keys: new Set<string>(),
    drag: false,
    lx: 0,
    ly: 0,
    wasFree: false,
  });

  useEffect(() => {
    // Test/debug hook (demo builds only): lets scripts place the camera in free-swim mode.
    if (DEMO) (window as unknown as { __wiRig?: unknown }).__wiRig = st.current;
  }, []);

  useEffect(() => {
    const s = st.current;
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      s.drag = true;
      s.lx = e.clientX;
      s.ly = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!s.drag) return;
      const dx = e.clientX - s.lx;
      const dy = e.clientY - s.ly;
      s.lx = e.clientX;
      s.ly = e.clientY;
      if (s.wasFree) {
        s.yaw -= dx * 0.005;
        s.pitch = Math.max(-1.3, Math.min(1.3, s.pitch - dy * 0.005));
      } else {
        s.offYaw -= dx * 0.005;
        s.offPitch = Math.max(-1.2, Math.min(1.2, s.offPitch - dy * 0.005));
      }
    };
    const up = () => {
      s.drag = false;
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    const kd = (e: KeyboardEvent) => {
      if (!freeSwim) return;
      const k = e.key.toLowerCase();
      if ('wasdqe'.includes(k) && k.length === 1) {
        s.keys.add(k);
        e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => s.keys.delete(e.key.toLowerCase());
    const clear = () => s.keys.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', clear);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', clear);
    };
  }, [gl, freeSwim]);

  useFrame((state, dtRaw) => {
    const s = st.current;
    const dt = Math.min(dtRaw, 0.1);
    const { curve, curveLength } = world;
    camera.rotation.order = 'YXZ';
    if (!freeSwim) {
      s.wasFree = false;
      const time = reducedMotion ? 0 : state.clock.elapsedTime;
      if (!reducedMotion) s.t = (s.t + (dt * 0.32) / curveLength) % 1;
      curve.getPointAt(s.t, s.pos);
      // A slow breathing bob, as if hanging in the water.
      s.pos.y = Math.min(-0.45, s.pos.y + Math.sin(time * 0.45) * 0.07);
      const sway = Math.sin(s.t * Math.PI * 2) * 0.1 + Math.sin(time * 0.13) * 0.04;
      s.yaw = world.heroYaw + sway + s.offYaw;
      s.pitch = world.heroPitch + Math.sin(time * 0.31) * 0.015 + s.offPitch;
    } else {
      if (!s.wasFree) {
        s.wasFree = true;
        s.offYaw = 0;
        s.offPitch = 0;
      }
      const fwd = (s.keys.has('w') ? 1 : 0) - (s.keys.has('s') ? 1 : 0);
      const strafe = (s.keys.has('d') ? 1 : 0) - (s.keys.has('a') ? 1 : 0);
      const vert = (s.keys.has('e') ? 1 : 0) - (s.keys.has('q') ? 1 : 0);
      const speed = 5 * (reducedMotion ? 0.5 : 1);
      const cp = Math.cos(s.pitch);
      s.pos.x += (-Math.sin(s.yaw) * cp * fwd + Math.cos(s.yaw) * strafe) * speed * dt;
      s.pos.y += (Math.sin(s.pitch) * fwd + vert) * speed * dt;
      s.pos.z += (-Math.cos(s.yaw) * cp * fwd - Math.sin(s.yaw) * strafe) * speed * dt;
      const lim = HALF - 4;
      s.pos.x = Math.min(lim, Math.max(-lim + 6, s.pos.x));
      s.pos.z = Math.min(lim, Math.max(-lim, s.pos.z));
      const bed = world.bedDepth(s.pos.x, s.pos.z);
      s.pos.y = Math.min(-0.4, Math.max(-bed + 0.5, s.pos.y));
    }
    camera.position.copy(s.pos);
    camera.rotation.set(s.pitch, s.yaw, freeSwim ? 0 : Math.sin(s.t * Math.PI * 4) * 0.012);
  });
  return null;
}
