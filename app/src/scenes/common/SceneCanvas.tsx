import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useDocumentVisible } from '../../lib/hooks';

/** 0.4 to 1: multiplier for pixel ratio, particle counts and fish counts. */
export const QualityContext = createContext(1);
export const useRenderQuality = () => useContext(QualityContext);

function ReadySignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    if (++frames.current >= 3) {
      done.current = true;
      onReady();
    }
  });
  return null;
}

interface Props {
  view: string;
  cameraPosition: [number, number, number];
  fov?: number;
  near?: number;
  far?: number;
  background?: string;
  children: ReactNode;
  /** Extra data attributes for tests and debugging. */
  dataAttrs?: Record<string, string | number | boolean>;
}

/**
 * Shared R3F canvas: Suspense boundary, adaptive quality (drei PerformanceMonitor drops pixel ratio,
 * particle counts and fish counts below 45 fps) and demand rendering while the tab is hidden.
 */
export function SceneCanvas({
  view,
  cameraPosition,
  fov = 45,
  near = 0.1,
  far = 1000,
  background = '#05121a',
  children,
  dataAttrs,
}: Props) {
  const visible = useDocumentVisible();
  const [quality, setQuality] = useState(1);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(false), [view]);
  const dprMax = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(dataAttrs ?? {})) data[`data-${k}`] = String(v);
  return (
    <div
      className="absolute inset-0"
      data-testid="scene-canvas"
      data-scene-ready={ready ? 'true' : 'false'}
      data-quality={quality.toFixed(1)}
      data-view={view}
      {...data}
    >
      <Canvas
        frameloop={visible ? 'always' : 'demand'}
        dpr={Math.max(0.5, dprMax * quality)}
        camera={{ position: cameraPosition, fov, near, far }}
        gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      >
        <color attach="background" args={[background]} />
        <PerformanceMonitor
          bounds={() => [45, 200]}
          flipflops={3}
          onDecline={() => setQuality((q) => Math.max(0.4, Math.round((q - 0.2) * 10) / 10))}
          onIncline={() => setQuality((q) => Math.min(1, Math.round((q + 0.1) * 10) / 10))}
        >
          <QualityContext.Provider value={quality}>
            <Suspense fallback={null}>{children}</Suspense>
            <ReadySignal onReady={() => setReady(true)} />
          </QualityContext.Provider>
        </PerformanceMonitor>
      </Canvas>
    </div>
  );
}
