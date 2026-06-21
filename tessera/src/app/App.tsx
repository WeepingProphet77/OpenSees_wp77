import { useState } from 'react';
import { Boxes, FolderOpen, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectStore } from '@/store/projectStore';
import { parseProject, pickAndReadTsr, saveProjectToFile } from '@/project/tsrFile';
import { APP_NAME, APP_VERSION } from '@/appInfo';
import { MemberWorkspace } from './MemberWorkspace';

/**
 * Tessera application shell: top bar with project name + .tsr controls, and the
 * Phase 1 single-member design workspace.
 */
function App() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const setMeta = useProjectStore((s) => s.setMeta);
  const loadProject = useProjectStore((s) => s.loadProject);
  const clearProject = useProjectStore((s) => s.clearProject);
  const markSaved = useProjectStore((s) => s.markSaved);

  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handleSave = async () => {
    try {
      if (await saveProjectToFile(project)) {
        markSaved();
        setStatus({ kind: 'ok', text: 'Saved .tsr file.' });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: `Save failed: ${(e as Error).message}` });
    }
  };

  const handleLoad = async () => {
    try {
      const text = await pickAndReadTsr();
      if (text == null) return;
      const result = parseProject(text);
      if (result.ok) {
        loadProject(result.project);
        setStatus({ kind: 'ok', text: `Loaded "${result.project.meta.name}".` });
      } else {
        setStatus({ kind: 'error', text: result.error });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: `Load failed: ${(e as Error).message}` });
    }
  };

  const handleClear = () => {
    if (dirty && !window.confirm('Discard unsaved changes and start a new project?')) return;
    clearProject();
    setStatus({ kind: 'ok', text: 'Started a new project.' });
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-5" />
            </div>
            <div>
              <div className="text-lg font-semibold leading-none tracking-tight">{APP_NAME}</div>
              <div className="text-[11px] text-muted-foreground">ACI 318-19 · PCI 8th · kip/in/ksi</div>
            </div>
          </div>

          <div className="ml-2 hidden items-center sm:flex">
            <Input
              value={project.meta.name}
              onChange={(e) => setMeta({ name: e.target.value })}
              className="h-8 w-56"
              placeholder="Project name"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {status && (
              <span
                className={
                  'hidden max-w-[280px] truncate text-xs md:inline ' +
                  (status.kind === 'ok' ? 'text-muted-foreground' : 'text-destructive')
                }
                title={status.text}
              >
                {status.text}
              </span>
            )}
            <span className={'text-xs font-medium ' + (dirty ? 'text-destructive' : 'text-muted-foreground')}>
              {dirty ? '● Unsaved' : 'Saved'}
            </span>
            <Button size="sm" onClick={handleSave}>
              <Save /> Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleLoad}>
              <FolderOpen /> Load
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClear}>
              <Trash2 /> New
            </Button>
            <span className="rounded-full border border-input px-2 py-0.5 text-[11px] text-muted-foreground">
              v{APP_VERSION}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <MemberWorkspace />
      </main>
    </div>
  );
}

export default App;
