import { Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { cn } from '@/lib/utils';

export type WorkspaceView = 'member' | 'vierendeel';

interface NavItem {
  id: string;
  label: string;
}

function NavGroup({
  title,
  items,
  activeId,
  isActiveView,
  onSelect,
  onAdd,
  onRemove,
  addLabel,
}: {
  title: string;
  items: NavItem[];
  activeId: string | undefined;
  isActiveView: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <button
          type="button"
          aria-label={addLabel}
          title={addLabel}
          onClick={onAdd}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => {
          const active = isActiveView && it.id === activeId;
          return (
            <li
              key={it.id}
              className={cn(
                'group flex items-center rounded-md',
                active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
            >
              <button
                type="button"
                aria-current={active || undefined}
                onClick={() => onSelect(it.id)}
                className={cn(
                  'flex-1 truncate px-2.5 py-1.5 text-left text-sm',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {it.label}
              </button>
              {items.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove ${it.label}`}
                  onClick={() => onRemove(it.id)}
                  className="px-1.5 py-1.5 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Left-rail project navigator: lists the project's members and Vierendeel panels
 * as a tree, and drives which workspace + entity is active. Selecting an item
 * switches the view and makes it active; each group can add/remove entries.
 */
export function ProjectNavigator({
  view,
  onView,
  className,
}: {
  view: WorkspaceView;
  onView: (v: WorkspaceView) => void;
  className?: string;
}) {
  const memberDesigns = useProjectStore((s) => s.project.memberDesigns);
  const activeMemberId = useProjectStore((s) => s.project.activeMemberId);
  const vierendeelPanels = useProjectStore((s) => s.project.vierendeelPanels);
  const activeVierendeelId = useProjectStore((s) => s.project.activeVierendeelId);
  const selectMember = useProjectStore((s) => s.selectMember);
  const addMember = useProjectStore((s) => s.addMember);
  const removeMember = useProjectStore((s) => s.removeMember);
  const selectVierendeelPanel = useProjectStore((s) => s.selectVierendeelPanel);
  const addVierendeelPanel = useProjectStore((s) => s.addVierendeelPanel);
  const removeVierendeelPanel = useProjectStore((s) => s.removeVierendeelPanel);

  return (
    <nav className={cn('space-y-4', className)} aria-label="Project">
      <NavGroup
        title="Members"
        items={memberDesigns.map((m) => ({ id: m.id, label: m.design.name?.trim() || 'Untitled member' }))}
        activeId={activeMemberId}
        isActiveView={view === 'member'}
        onSelect={(id) => {
          selectMember(id);
          onView('member');
        }}
        onAdd={() => {
          addMember();
          onView('member');
        }}
        onRemove={removeMember}
        addLabel="Add member"
      />
      <NavGroup
        title="Vierendeel panels"
        items={vierendeelPanels.map((p) => ({ id: p.id, label: p.panel.name?.trim() || 'Untitled panel' }))}
        activeId={activeVierendeelId}
        isActiveView={view === 'vierendeel'}
        onSelect={(id) => {
          selectVierendeelPanel(id);
          onView('vierendeel');
        }}
        onAdd={() => {
          addVierendeelPanel();
          onView('vierendeel');
        }}
        onRemove={removeVierendeelPanel}
        addLabel="Add Vierendeel panel"
      />
    </nav>
  );
}
