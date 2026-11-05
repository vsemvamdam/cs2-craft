import type { Skin } from '../lib/data';
export function PatternBlock({ skin }: { skin: Skin }) {
  return <div className="card pad muted" style={{ textAlign: 'center' }}>Паттерны у этого скина не отличаются</div>;
}
