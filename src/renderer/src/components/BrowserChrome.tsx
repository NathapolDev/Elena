import { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkSimpleIcon } from '@phosphor-icons/react/BookmarkSimple'
import { CaretDownIcon } from '@phosphor-icons/react/CaretDown'
import { CaretRightIcon } from '@phosphor-icons/react/CaretRight'
import { DotsThreeIcon } from '@phosphor-icons/react/DotsThree'
import { FolderIcon } from '@phosphor-icons/react/Folder'
import { GitBranchIcon } from '@phosphor-icons/react/GitBranch'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/MagnifyingGlass'
import { PlusIcon } from '@phosphor-icons/react/Plus'
import { TerminalWindowIcon } from '@phosphor-icons/react/TerminalWindow'
import { ColumnsIcon } from '@phosphor-icons/react/Columns'
import { XIcon } from '@phosphor-icons/react/X'
import type { LayoutNode, TerminalConfig, Workspace } from '@shared/types'
import { useGitBranch } from '../lib/gitBranch'
import { describeError } from '../lib/api'
import { acquireTerminal } from '../lib/terminalRegistry'
import { selectActiveWorkspace, useStore } from '../state/store'
import { ChromePopover } from './ChromePopover'
import { StatusBadge } from './StatusBadge'
import { ChangesButton } from './ChangesButton'

export type ChromePanel = 'saved' | 'tabs' | 'new' | 'more' | 'split' | 'project' | null
export type SplitSelection = { workspaceId: string; ids: [string, string]; direction: 'horizontal' | 'vertical'; ratio: number }

type Props = {
  panel: ChromePanel
  onPanel: (panel: ChromePanel) => void
  onNewWorkspace: () => void
  onConfigure: () => void
  onRenameWorkspace: () => void
  onDeleteWorkspace: (workspace: Workspace) => void
  onRenameTerminal: () => void
  onSettings: () => void
  onAbout: () => void
  onChanges: () => void
  onSearch: () => void
  changesOpen: boolean
  split: SplitSelection | null
  onSplit: (selection: SplitSelection | null) => void
}

function terminalDescription(terminal: TerminalConfig, workspace: Workspace): string {
  return `${terminal.title} — ${workspace.name} — ${terminal.cwd}`
}

export function BrowserChrome({ panel, onPanel, onNewWorkspace, onConfigure, onRenameWorkspace, onDeleteWorkspace,
  onRenameTerminal, onSettings, onAbout, onChanges, onSearch, changesOpen, split, onSplit }: Props): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const workspace = useStore(selectActiveWorkspace)
  const openIds = useStore((s) => s.openWorkspaceIds)
  const collapsedIds = useStore((s) => s.collapsedWorkspaceIds)
  const activeTerminalId = useStore((s) => s.activeTerminalId)
  const sessions = useStore((s) => s.sessions)
  const unread = useStore((s) => s.unread)
  const presets = useStore((s) => s.presets)
  const shells = useStore((s) => s.shells)
  const active = workspace?.terminals.find((t) => t.id === activeTerminalId)
  const git = useGitBranch(active?.cwd ?? workspace?.projectRoot ?? '')
  const selectedTab = useRef<HTMLButtonElement>(null)
  const pendingLaunch = useRef(false)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState<{ panel: ChromePanel; value: string }>({ panel: null, value: '' })
  const query = search.panel === panel ? search.value : ''
  const setQuery = (value: string): void => setSearch({ panel, value })
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null)
  const [splitDirection, setSplitDirection] = useState<'horizontal' | 'vertical'>('horizontal')
  const needle = query.trim().toLowerCase()
  const openProjects = useMemo(() => openIds.flatMap((id) => {
    const project = workspaces.find((w) => w.id === id)
    return project ? [project] : []
  }), [openIds, workspaces])
  const projects = workspaces.filter((w) => `${w.name} ${w.projectRoot}`.toLowerCase().includes(needle))
  const projectMenu = workspaces.find((w) => w.id === projectMenuId)
  const currentSplit = split?.workspaceId === workspace?.id ? split : null
  const closePopup = (): void => { onPanel(null); setProjectMenuId(null); setQuery('') }
  const togglePanel = (next: ChromePanel): void => {
    setProjectMenuId(null)
    setQuery('')
    onPanel(panel === next ? null : next)
  }
  useEffect(() => {
    selectedTab.current?.closest('.browser-tab')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTerminalId, collapsedIds, openIds])

  const launch = async (source: { kind: 'preset' | 'shell'; id: string }): Promise<void> => {
    if (pendingLaunch.current) return
    const target = workspace
    const preset = source.kind === 'preset' ? presets.find((p) => p.id === source.id) : undefined
    const shell = source.kind === 'shell' ? shells.find((s) => s.id === source.id) : undefined
    if (!target && !preset) return
    pendingLaunch.current = true
    setBusy(true)
    closePopup()
    try {
      if (!target && preset) {
        await useStore.getState().startQuickSession(preset.id)
        return
      }
      if (!target) return
      const executable = preset?.executable ?? shell?.executable
      if (!executable) throw new Error(preset?.installHint ?? 'Configure this preset in Settings → Presets.')
      await useStore.getState().addTerminal({
        workspaceId: target.id,
        title: preset?.name ?? shell?.name ?? 'Shell',
        executable,
        args: preset?.args ?? shell?.args ?? [],
        cwd: preset?.defaultCwd || target.projectRoot,
        envAllowlist: preset?.envAllowlist ?? [],
        ...(preset ? { presetId: preset.id } : {})
      })
    } catch (error) {
      const described = describeError(error)
      useStore.getState().pushToast({ title: described.title, body: `${described.body}${preset?.installHint ? ` ${preset.installHint}` : ''}`, tone: 'error' })
    } finally {
      pendingLaunch.current = false
      setBusy(false)
    }
  }

  const start = (): void => {
    if (!active) return
    const store = useStore.getState()
    const entry = acquireTerminal(active.id, { scrollback: store.settings.scrollback, onOutput: () => store.markUnread(active.id) })
    if (store.sessions[active.id]) {
      entry.term.clear()
      void store.restartTerminal(active.id, entry.term.cols, entry.term.rows)
    } else void store.startTerminal(active.id, entry.term.cols, entry.term.rows)
    closePopup()
  }

  const selectTab = (id: string, keyboard = false): void => {
    useStore.getState().focusTerminal(id)
    closePopup()
    if (keyboard) requestAnimationFrame(() => selectedTab.current?.focus())
  }

  return (
    <>
      <nav className="browser-tabs" aria-label="Projects and session tabs">
        <div className="browser-tabs__scroll">
          {openProjects.map((project, index) => {
            const collapsed = collapsedIds.includes(project.id)
            const running = project.terminals.filter((t) => sessions[t.id]?.status === 'running' || sessions[t.id]?.status === 'starting').length
            const hasUnread = project.terminals.some((t) => unread[t.id])
            return (
              <div className={`project-group project-group--${index % 3} ${project.id === workspace?.id ? 'project-group--active' : ''}`} key={project.id}>
                <button
                  type="button"
                  className="project-group__label"
                  aria-label={`${collapsed ? 'Expand' : 'Collapse'} project ${project.name}`}
                  aria-expanded={!collapsed}
                  title={`${project.name} — ${project.projectRoot}\n${running} running${hasUnread ? ' · New output' : ''}\nRight-click for project actions`}
                  onClick={() => project.terminals.length ? useStore.getState().toggleProjectCollapsed(project.id) : useStore.getState().selectWorkspace(project.id)}
                  onContextMenu={(event) => { event.preventDefault(); onPanel('project'); setProjectMenuId(project.id) }}
                  onKeyDown={(event) => {
                    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                      event.preventDefault(); onPanel('project'); setProjectMenuId(project.id)
                    }
                  }}
                >
                  <span className="project-group__name">{project.name}</span>
                  {collapsed && <span className="project-group__count">{project.terminals.length}</span>}
                  {hasUnread && <span className="tab-unread" aria-label="New output" />}
                  {collapsed ? <CaretRightIcon size={13} /> : <CaretDownIcon size={13} />}
                </button>
                {!collapsed && (
                  <div className="project-group__tabs" role="tablist" aria-label={`${project.name} sessions`}>
                    {project.terminals.map((terminal) => {
                      const selected = project.id === workspace?.id && terminal.id === activeTerminalId
                      return (
                        <div className={`browser-tab ${selected ? 'browser-tab--active' : ''}`} key={terminal.id}>
                          <button type="button" role="tab" aria-label={terminal.title} aria-description={unread[terminal.id] ? 'New output' : undefined} aria-selected={selected} aria-controls="workspace-terminal" tabIndex={selected ? 0 : -1}
                            ref={selected ? selectedTab : undefined} title={terminalDescription(terminal, project)}
                            onClick={() => selectTab(terminal.id)}
                            onKeyDown={(event) => {
                              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                              event.preventDefault()
                              const current = project.terminals.findIndex((t) => t.id === terminal.id)
                              const next = event.key === 'Home' ? 0 : event.key === 'End' ? project.terminals.length - 1
                                : (current + (event.key === 'ArrowLeft' ? -1 : 1) + project.terminals.length) % project.terminals.length
                              const target = project.terminals[next]
                              if (target) selectTab(target.id, true)
                            }}>
                            <TerminalWindowIcon size={16} aria-hidden="true" />
                            <span className="browser-tab__title">{terminal.title}</span>
                            {unread[terminal.id] && <span className="tab-unread" aria-label="New output" />}
                          </button>
                          <button type="button" className="browser-tab__close" aria-label={`Close session ${terminal.title}`} title="Close session"
                            onClick={() => { useStore.getState().selectWorkspace(project.id); useStore.getState().requestTerminalClose(terminal.id) }}>
                            <XIcon size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {openProjects.length === 0 && <span className="browser-tabs__empty">Elena</span>}
        </div>
        <button type="button" className="icon-button browser-tabs__add" aria-label="New session" title="New session (Ctrl+T)" disabled={busy} aria-busy={busy} aria-expanded={panel === 'new'} onClick={() => togglePanel('new')}><PlusIcon size={20} /></button>
        <span className="browser-tabs__spacer" />
        <button type="button" className="icon-button" aria-label="Saved projects" title="Saved projects (Ctrl+B)" aria-expanded={panel === 'saved'} onClick={() => togglePanel('saved')}><BookmarkSimpleIcon size={19} /></button>
        <button type="button" className="icon-button" aria-label="All tabs" title="Search open tabs" aria-expanded={panel === 'tabs'} onClick={() => togglePanel('tabs')}><CaretDownIcon size={19} /></button>
      </nav>

      <header className="browser-toolbar">
        <div className="browser-toolbar__context">
          <FolderIcon size={18} aria-hidden="true" />
          <span className="browser-toolbar__path" title={active?.cwd ?? workspace?.projectRoot}>{active?.cwd ?? workspace?.projectRoot ?? 'Open a saved project to get started'}</span>
          {git && <span className="browser-toolbar__branch" title={git.root}><GitBranchIcon size={16} /><span>{git.branch}</span></span>}
        </div>
        {active && <StatusBadge {...(sessions[active.id] ? { session: sessions[active.id] } : {})} />}
        <button type="button" className="toolbar-action" disabled={!active} aria-label={currentSplit ? 'Return to single terminal' : 'Split terminal'}
          onClick={() => currentSplit ? onSplit(null) : togglePanel('split')}><ColumnsIcon size={18} />{currentSplit ? 'Single' : 'Split'}</button>
        <button type="button" className="icon-button" aria-label="Search terminal" title="Search terminal buffer" disabled={!active} onClick={onSearch}><MagnifyingGlassIcon size={19} /></button>
        <button type="button" className="icon-button" aria-label="More actions" title="Session and project actions" aria-expanded={panel === 'more'} onClick={() => togglePanel('more')}><DotsThreeIcon size={22} /></button>
      </header>

      {panel === 'project' && projectMenu && (
        <ChromePopover title={projectMenu.name} onClose={closePopup}>
          <button type="button" onClick={() => { useStore.getState().selectWorkspace(projectMenu.id); closePopup() }}>Focus project</button>
          <button type="button" onClick={() => { useStore.getState().selectWorkspace(projectMenu.id); closePopup(); onRenameWorkspace() }}>Rename project</button>
          <button type="button" aria-label="Close project" aria-description="Sessions keep running" onClick={() => { useStore.getState().closeProject(projectMenu.id); closePopup() }}>Close project <small>Sessions keep running</small></button>
        </ChromePopover>
      )}
      {(panel === 'saved' || panel === 'tabs') && (
        <ChromePopover key={panel} title={panel === 'saved' ? 'Saved projects' : 'All tabs'} onClose={closePopup} wide>
          <input className="chrome-popover__search" aria-label={panel === 'saved' ? 'Search saved projects' : 'Search open tabs'} placeholder={panel === 'saved' ? 'Search name or folder…' : 'Search session or project…'} value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="chrome-popover__list">
            {panel === 'saved' ? projects.map((project) => {
              const running = project.terminals.filter((t) => sessions[t.id]?.status === 'running' || sessions[t.id]?.status === 'starting').length
              const hasUnread = project.terminals.some((t) => unread[t.id])
              return (
                <div className="saved-project" key={project.id}>
                  <button type="button" className="saved-project__open" aria-label={`Open project ${project.name}`} onClick={() => { void useStore.getState().openWorkspaceById(project.id); closePopup() }}>
                    <FolderIcon size={20} />
                    <span className="saved-project__identity"><strong>{project.name}</strong><small title={project.projectRoot}>{project.projectRoot}</small>
                      <span className="saved-project__state">{openIds.includes(project.id) ? 'Open' : 'Saved'}{running > 0 ? ` · ${running} running` : ''}{hasUnread ? ' · New output' : ''}</span>
                    </span>
                  </button>
                  <button type="button" className="icon-button" aria-label={`Delete saved project ${project.name}`} title="Delete saved project" onClick={() => { closePopup(); onDeleteWorkspace(project) }}><XIcon size={15} /></button>
                </div>
              )
            }) : openProjects.flatMap((project) => project.terminals.filter((terminal) => `${terminal.title} ${project.name} ${terminal.cwd}`.toLowerCase().includes(needle)).map((terminal) => (
              <button type="button" className="all-tab" key={terminal.id} onClick={() => selectTab(terminal.id)}>
                <TerminalWindowIcon size={18} /><span><strong>{terminal.title}</strong><small>{project.name}</small></span>
                <StatusBadge {...(sessions[terminal.id] ? { session: sessions[terminal.id] } : {})} />
                {unread[terminal.id] && <span className="tab-unread" aria-label="New output" />}
              </button>
            )))}
            {((panel === 'saved' && projects.length === 0) || (panel === 'tabs' && !openProjects.some((p) => p.terminals.some((t) => `${t.title} ${p.name} ${t.cwd}`.toLowerCase().includes(needle))))) && <p className="chrome-popover__empty">{needle ? 'No matches.' : panel === 'saved' ? 'No saved projects yet.' : 'No open sessions.'}</p>}
          </div>
          {panel === 'saved' && <button type="button" onClick={() => { closePopup(); onNewWorkspace() }}><PlusIcon size={17} /> New project…</button>}
        </ChromePopover>
      )}
      {panel === 'new' && (
        <ChromePopover title={workspace ? `New session · ${workspace.name}` : 'Open a project or start an agent'} onClose={closePopup}>
          <div className="chrome-popover__list">
            {presets.map((preset) => <button type="button" key={preset.id} disabled={busy || !preset.executable} title={preset.installHint} onClick={() => void launch({ kind: 'preset', id: preset.id })}><TerminalWindowIcon size={17} />{preset.name}{!preset.executable && <small>Configure in Settings</small>}</button>)}
            {workspace && shells.map((shell) => <button type="button" key={shell.id} disabled={busy} onClick={() => void launch({ kind: 'shell', id: shell.id })}><TerminalWindowIcon size={17} />{shell.name}</button>)}
          </div>
          <div className="chrome-popover__divider" />
          <button type="button" disabled={!workspace || busy} onClick={() => { closePopup(); onConfigure() }}>Configure… <small>cwd, command, placement</small></button>
          <button type="button" onClick={() => togglePanel('saved')}><BookmarkSimpleIcon size={17} /> Open saved project…</button>
          <button type="button" onClick={() => { closePopup(); onNewWorkspace() }}><FolderIcon size={17} /> New project…</button>
          <button type="button" onClick={() => { closePopup(); onSettings() }}>Preset settings…</button>
        </ChromePopover>
      )}
      {panel === 'split' && workspace && active && (
        <ChromePopover title="Split terminal" onClose={closePopup}>
          <div className="segmented" role="group" aria-label="Split direction">
            <button type="button" className="segmented__option" aria-pressed={splitDirection === 'horizontal'} onClick={() => setSplitDirection('horizontal')}>Right</button>
            <button type="button" className="segmented__option" aria-pressed={splitDirection === 'vertical'} onClick={() => setSplitDirection('vertical')}>Below</button>
          </div>
          <div className="chrome-popover__list">
            {workspace.terminals.filter((t) => t.id !== active.id).map((terminal) => <button type="button" key={terminal.id} onClick={() => {
              onSplit({ workspaceId: workspace.id, ids: [active.id, terminal.id], direction: splitDirection, ratio: 0.5 }); closePopup()
            }}><TerminalWindowIcon size={17} />{terminal.title}</button>)}
            {workspace.terminals.length < 2 && <p className="chrome-popover__empty">Add another session to split this view.</p>}
          </div>
          <button type="button" onClick={() => togglePanel('new')}><PlusIcon size={17} /> Add session…</button>
        </ChromePopover>
      )}
      {panel === 'more' && (
        <ChromePopover title="Actions" onClose={closePopup}>
          <div className="chrome-popover__list">
            <button type="button" disabled={!active} onClick={start}>{active && sessions[active.id] ? 'Restart' : 'Start'} session</button>
            <button type="button" disabled={!active || !['running', 'starting'].includes(sessions[active.id]?.status ?? '')} onClick={() => { if (active) void useStore.getState().stopTerminal(active.id); closePopup() }}>Stop session</button>
            <button type="button" disabled={!active} onClick={() => { closePopup(); onRenameTerminal() }}>Rename session</button>
            <button type="button" disabled={!active} onClick={() => { if (active) void useStore.getState().detachTerminal(active.id); closePopup() }}>Open in new window</button>
            <button type="button" disabled={!active} onClick={() => { if (active) useStore.getState().requestTerminalClose(active.id); closePopup() }}>Close session</button>
            <button type="button" disabled={!active} onClick={() => {
              const terminal = active && acquireTerminal(active.id, { scrollback: useStore.getState().settings.scrollback, onOutput: () => {} }).term
              closePopup()
              requestAnimationFrame(() => { if (terminal) { terminal.focus(); terminal.selectAll() } })
            }}>Select all</button>
            <button type="button" disabled={!active} onClick={() => {
              const terminal = active && acquireTerminal(active.id, { scrollback: useStore.getState().settings.scrollback, onOutput: () => {} }).term
              closePopup()
              requestAnimationFrame(() => { if (terminal) { terminal.clear(); terminal.focus() } })
            }}>Clear terminal</button>
            <div className="chrome-popover__divider" />
            <ChangesButton workspaceId={workspace?.id} dialogOpen={changesOpen} onClick={() => { closePopup(); onChanges() }} />
            <button type="button" disabled={!workspace} onClick={() => { closePopup(); onRenameWorkspace() }}>Rename project</button>
            <button type="button" aria-label="Close project" aria-description="Sessions keep running" disabled={!workspace} onClick={() => { if (workspace) useStore.getState().closeProject(workspace.id); closePopup() }}>Close project <small>Sessions keep running</small></button>
            <div className="chrome-popover__divider" />
            <button type="button" onClick={() => { closePopup(); onSettings() }}>Settings</button>
            <button type="button" onClick={() => { closePopup(); onAbout() }}>About Elena</button>
          </div>
        </ChromePopover>
      )}
    </>
  )
}

/** A view tree, never a replacement for the persisted workspace layout. */
export function splitViewNode(selection: SplitSelection): LayoutNode {
  return { type: 'split', direction: selection.direction, ratio: selection.ratio,
    children: [{ type: 'terminal', terminalId: selection.ids[0] }, { type: 'terminal', terminalId: selection.ids[1] }] }
}
