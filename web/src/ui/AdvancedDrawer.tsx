import { BackendPanel } from './BackendPanel';
import { PresetsPanel } from './PresetsPanel';
import { VibePanel } from './VibePanel';
import { useStore } from '../services/store';

export function AdvancedDrawer() {
  const open = useStore((s) => s.advancedOpen);
  const setOpen = useStore((s) => s.setAdvancedOpen);
  return (
    <section className={`drawer${open ? ' is-open' : ''}`}>
      <button type="button" className="drawer__toggle btn btn--small" onClick={() => setOpen(!open)}>
        {open ? 'Hide advanced' : 'Advanced / Engine'}
      </button>
      {open && (
        <div className="drawer__body">
          <BackendPanel />
          <VibePanel />
          <PresetsPanel />
        </div>
      )}
    </section>
  );
}
