import { useUi } from '../store';

/** Placeholder until the 3D scenes land. */
export default function SceneHost() {
  const view = useUi((s) => s.view);
  return <div className="grid h-full place-items-center text-white">{view}</div>;
}
