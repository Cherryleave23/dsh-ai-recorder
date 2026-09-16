/**
 * 「录音内容」页 —— 录音库。
 *
 * 布局：左侧会话列表，右侧详情；详情上为音频播放器，下为转写文档。
 * 点转写稿里的时间戳会跳转播放位置（需要播放器已就绪）。
 */
import * as React from 'react'
import {
  SOURCE_LABEL,
  audioUrl,
  deleteSession,
  deleteSessions,
  downloadName,
  extOf,
  fmtBytes,
  fmtClock,
  fmtDateTime,
  fmtDay,
  get,
  markdownUrl,
  post,
  setTitle,
  type SessionListRow,
  type SessionRecord,
  type SessionArtifacts,
} from './api.js'
import { AudioPlayer } from './AudioPlayer.js'
import { Btn, C, Chip, Empty, ErrorBar, Loading, Muted, mono } from './ui.js'

interface DetailPayload {
  ok: true
  session: SessionRecord
  artifacts: SessionArtifacts
  completeness: string
  /** 这条录音被交给 LLM 的历史（总结 / 投放都算） */
  flows?: Array<{
    sessionId: string
    kind: 'summary' | 'deliver' | 'auto'
    targetSessionId: string
    at: string
    templateId?: string
    batchSize?: number
  }>
  notes?: Array<{ slug: string; title: string; path: string; bytes: number; updatedAt: string }>
}

export function RecorderLibrary(): React.ReactElement {
  const [rows, setRows] = React.useState<SessionListRow[] | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)

  // ── 投放：把选中的录音按选定模板发给对话 ──
  const [deliverTemplates, setDeliverTemplates] = React.useState<Array<{ id: string; name: string }>>([])
  const [deliverTemplateId, setDeliverTemplateId] = React.useState('')
  const [deliverFormat, setDeliverFormat] = React.useState<'transcript' | 'markdown' | 'notes'>('transcript')
  const [delivering, setDelivering] = React.useState(false)
  const [deliverMsg, setDeliverMsg] = React.useState<string | null>(null)
  /** 投放目标：主机上报的「当前打开的会话」 */
  const [openSession, setOpenSession] = React.useState<{ sessionId: string | null; title: string | null }>({
    sessionId: null,
    title: null,
  })
  React.useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const r = await get<{ sessionId: string | null; title: string | null }>('/open-session')
        setOpenSession({ sessionId: r.sessionId, title: r.title })
      } catch {
        /* 取不到就显示未知 */
      }
    }
    void load()
    // 你会切换对话，所以目标要跟着变；只在多选模式时轮询，别的时候不打扰后端
    const t = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(t)
  }, [])
  React.useEffect(() => {
    void (async () => {
      try {
        const r = await get<{ templates: Array<{ id: string; name: string }>; config: { templateId: string } }>(
          '/post-process',
        )
        setDeliverTemplates(r.templates ?? [])
        setDeliverTemplateId((cur) => cur || r.config?.templateId || r.templates?.[0]?.id || '')
      } catch {
        /* 模板取不到时按钮会提示 */
      }
    })()
  }, [])
  const [detail, setDetail] = React.useState<DetailPayload | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState('')
  /** 待确认删除的会话 id：列表与详情共用一个确认态，避免出现两处「确认」 */
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  /** 批量选择态：进入后点击行 = 勾选，而不是切换详情 */
  const [selectMode, setSelectMode] = React.useState(false)
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set())
  const [confirmBatch, setConfirmBatch] = React.useState(false)
  const seekRef = React.useRef<((sec: number) => void) | null>(null)

  const loadList = React.useCallback(async (keepSelection = true) => {
    try {
      const r = await get<{ ok: true; items: SessionListRow[] }>('/sessions')
      setRows(r.items ?? [])
      setErr(null)
      setSelected((prev) => {
        if (keepSelection && prev && (r.items ?? []).some((x) => x.id === prev)) return prev
        return r.items?.[0]?.id ?? null
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  React.useEffect(() => {
    void loadList(false)
  }, [loadList])

  // 拉详情
  React.useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    let alive = true
    setDetailLoading(true)
    void (async () => {
      try {
        const r = await get<DetailPayload>(`/session/${encodeURIComponent(selected)}`)
        if (alive) {
          setDetail(r)
          setErr(null)
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setDetailLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [selected])

  const shown = React.useMemo(() => {
    const list = rows ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (r) =>
        (r.title ?? '').toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        fmtDateTime(r.createdAt).includes(q) ||
        (SOURCE_LABEL[r.source] ?? r.source).includes(q),
    )
  }, [rows, filter])

  /**
   * 删除一条录音。**不可恢复**，所以只从二次确认态进得来。
   * 删完自动选中原来位置的邻居，避免列表跳回第一条。
   */
  const doDelete = React.useCallback(
    async (id: string) => {
      setDeleting(true)
      setErr(null)
      try {
        await deleteSession(id)
        const idx = shown.findIndex((r) => r.id === id)
        const neighbour = shown[idx + 1]?.id ?? shown[idx - 1]?.id ?? null
        setPendingDelete(null)
        if (selected === id) setDetail(null)
        await loadList()
        if (neighbour) setSelected(neighbour)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setDeleting(false)
      }
    },
    [shown, selected, loadList],
  )

  const pickedRows = React.useMemo(() => shown.filter((r) => picked.has(r.id)), [shown, picked])
  const pickedBytes = pickedRows.reduce((n, r) => n + (r.bytes || 0), 0)
  const pickedWithSummary = pickedRows.filter((r) => r.hasSummary).length

  /** 批量删除：一次请求，host 逐条走同一路径；失败的条目如实报出来。 */
  const doBatchDelete = React.useCallback(async () => {
    const ids = pickedRows.map((r) => r.id)
    if (ids.length === 0) return
    setDeleting(true)
    setErr(null)
    try {
      const r = await deleteSessions(ids)
      if (r.failed.length > 0) {
        setErr(
          `${r.deleted.length} 条已删除，${r.failed.length} 条失败：` +
            r.failed.slice(0, 3).map((f) => `${f.id}（${f.error}）`).join('；'),
        )
      }
      if (selected && ids.includes(selected)) setDetail(null)
      setPicked(new Set())
      setConfirmBatch(false)
      await loadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }, [pickedRows, selected, loadList])

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, background: C.bg1, color: C.ink }}>
      {/* ───────── 左：列表 ───────── */}
      <aside
        style={{
          width: 292,
          flexShrink: 0,
          borderRight: `1px solid ${C.border}`,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: C.bg2,
        }}
      >
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索录音…"
              style={{
                flex: 1,
                minWidth: 0,
                border: `1px solid ${C.border3}`,
                background: C.bg1,
                color: C.ink,
                borderRadius: 6,
                padding: '5px 9px',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <Btn small onClick={() => void loadList()} title="刷新列表">
              刷新
            </Btn>
            <Btn
              small
              primary={selectMode}
              title="多选删除"
              onClick={() => {
                setSelectMode((v) => !v)
                setPicked(new Set())
                setConfirmBatch(false)
                setPendingDelete(null)
              }}
            >
              {selectMode ? '退出多选' : '多选'}
            </Btn>
          </div>

          {selectMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  const all = shown.length > 0 && shown.every((r) => picked.has(r.id))
                  setPicked(all ? new Set() : new Set(shown.map((r) => r.id)))
                }}
                style={{
                  border: `1px solid ${C.border3}`,
                  background: C.bg1,
                  color: C.ink2,
                  borderRadius: 6,
                  padding: '2px 8px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {shown.length > 0 && shown.every((r) => picked.has(r.id)) ? '取消全选' : '全选'}
              </button>
              <span style={{ fontSize: 11, color: C.ink3 }}>
                已选 {picked.size} 条
                {picked.size > 0 ? ` · ${fmtBytes(pickedBytes)}` : ''}
              </span>
              <Btn
                small
                danger
                disabled={picked.size === 0 || deleting}
                style={{ marginLeft: 'auto' }}
                onClick={() => setConfirmBatch(true)}
              >
                删除选中
              </Btn>
            </div>
          )}

          {/* 投放：把选中的录音交给 Agent。目标对话是**当前打开的那个**
              （主机侧取最近活跃的会话），多选时默认把转写原文拼接成一条发送。 */}
          {selectMode && (
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: `1px solid ${C.border}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, color: C.ink3, lineHeight: 1.5 }}>
                投放目标：
                <span style={{ color: C.ink, fontWeight: 600 }}>
                  {openSession.title ?? openSession.sessionId ?? '（尚未识别到当前对话）'}
                </span>
                {openSession.sessionId && (
                  <span style={{ color: C.ink3 }}> · 当前打开的那个对话</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: C.ink3, flexShrink: 0 }}>投放内容</span>
                <select
                  value={deliverFormat}
                  onChange={(e) => setDeliverFormat(e.target.value as 'transcript' | 'markdown' | 'notes')}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: `1px solid ${C.border3}`,
                    background: C.bg1,
                    color: C.ink,
                    borderRadius: 6,
                    padding: '3px 6px',
                    fontSize: 11,
                  }}
                >
                  <option value="transcript">转写原文</option>
                  <option value="markdown">Markdown 文档</option>
                  <option value="notes">纪要</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: C.ink3, flexShrink: 0 }}>提示词</span>
                <select
                  value={deliverTemplateId}
                  onChange={(e) => setDeliverTemplateId(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: `1px solid ${C.border3}`,
                    background: C.bg1,
                    color: C.ink,
                    borderRadius: 6,
                    padding: '3px 6px',
                    fontSize: 11,
                  }}
                >
                  {deliverTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <Btn
                small
                primary
                disabled={picked.size === 0 || delivering || !deliverTemplateId}
                onClick={() =>
                  void (async () => {
                    setDelivering(true)
                    setDeliverMsg(null)
                    try {
                      const r = await post<{ sessionId: string; sent: number; skipped: string[] }>('/deliver', {
                        sessionIds: [...picked],
                        format: deliverFormat,
                        templateId: deliverTemplateId,
                      })
                      setDeliverMsg(
                        `已投放 ${r.sent} 条 → 会话 ${r.sessionId.slice(0, 18)}…` +
                          (r.skipped.length > 0 ? `（跳过 ${r.skipped.length} 条）` : ''),
                      )
                      setPicked(new Set())
                      await loadList()
                    } catch (e) {
                      setDeliverMsg(`投放失败：${e instanceof Error ? e.message : String(e)}`)
                    } finally {
                      setDelivering(false)
                    }
                  })()
                }
              >
                {delivering ? '投放中…' : '投放给 Agent' + (picked.size > 0 ? ' (' + String(picked.size) + ')' : '')}
              </Btn>
              {deliverMsg && <span style={{ fontSize: 11, color: C.ink3 }}>{deliverMsg}</span>}
            </div>
          )}
        </div>

        {confirmBatch && (
          <div
            style={{
              padding: '9px 12px',
              background: C.hoverDanger,
              borderBottom: `1px solid ${C.danger}`,
              fontSize: 12,
              color: C.danger,
              lineHeight: 1.75,
            }}
          >
            <div style={{ marginBottom: 7 }}>
              删除选中的 <strong>{picked.size}</strong> 条录音（共 {fmtBytes(pickedBytes)}）？
              音频与转写文档会一并删掉，<strong>不可恢复</strong>。
              {pickedWithSummary > 0 && (
                <div style={{ marginTop: 3 }}>
                  其中 {pickedWithSummary} 条已有 LLM 总结，总结会先归档到 summaries/ 再删，不会丢。
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn small danger disabled={deleting} onClick={() => void doBatchDelete()}>
                {deleting ? '删除中…' : '确认删除'}
              </Btn>
              <Btn small disabled={deleting} onClick={() => setConfirmBatch(false)}>
                取消
              </Btn>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {rows === null ? (
            <Loading />
          ) : shown.length === 0 ? (
            <Empty>
              {rows.length === 0 ? (
                <>
                  还没有录音。
                  <br />
                  到「录音卡后端」页连上设备同步，或上传音频。
                </>
              ) : (
                '没有匹配的录音'
              )}
            </Empty>
          ) : (
            shown.map((r) => (
              <SessionItem
                key={r.id}
                row={r}
                active={r.id === selected}
                confirming={pendingDelete === r.id}
                busy={deleting}
                selectMode={selectMode}
                picked={picked.has(r.id)}
                onTogglePick={() =>
                  setPicked((prev) => {
                    const next = new Set(prev)
                    if (next.has(r.id)) next.delete(r.id)
                    else next.add(r.id)
                    return next
                  })
                }
                onClick={() => {
                  if (selectMode) {
                    setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(r.id)) next.delete(r.id)
                      else next.add(r.id)
                      return next
                    })
                    return
                  }
                  setPendingDelete(null)
                  setSelected(r.id)
                }}
                onAskDelete={() => setPendingDelete(r.id)}
                onCancelDelete={() => setPendingDelete(null)}
                onConfirmDelete={() => void doDelete(r.id)}
              />
            ))
          )}
        </div>

        <div style={{ padding: '7px 12px', borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.ink3 }}>
          共 {rows?.length ?? 0} 条录音
        </div>
      </aside>

      {/* ───────── 右：详情 ───────── */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {err && (
          <div style={{ padding: 12 }}>
            <ErrorBar text={err} onClose={() => setErr(null)} />
          </div>
        )}

        {!selected ? (
          <Empty>从左侧选一条录音查看内容</Empty>
        ) : detailLoading && !detail ? (
          <Loading text="正在读取录音…" />
        ) : !detail ? (
          <Empty>读取失败</Empty>
        ) : (
          <SessionDetail
            detail={detail}
            seekRef={seekRef}
            confirmingDelete={pendingDelete === detail.session.id}
            deleting={deleting}
            onAskDelete={() => setPendingDelete(detail.session.id)}
            onCancelDelete={() => setPendingDelete(null)}
            onConfirmDelete={() => void doDelete(detail.session.id)}
            onRenamed={(session) => {
              // 改名后 host 已经把磁盘产物也改了，这里同步刷新详情与列表
              setDetail((prev) => (prev ? { ...prev, session } : prev))
              void loadList()
            }}
          />
        )}
      </main>
    </div>
  )
}

// ─────────────────────────── 列表项 ───────────────────────────

function SessionItem(props: {
  row: SessionListRow
  active: boolean
  confirming: boolean
  busy: boolean
  selectMode: boolean
  picked: boolean
  onTogglePick: () => void
  onClick: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}): React.ReactElement {
  const { row, active, confirming, selectMode, picked } = props
  const [hover, setHover] = React.useState(false)
  const highlight = confirming || (selectMode && picked)
  return (
    // 用 div 而不是 button：行内还要放删除按钮与勾选框，button 不能嵌套 button
    <div
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onClick()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        borderLeft: `3px solid ${active && !selectMode ? C.brand : 'transparent'}`,
        background: highlight ? C.hoverDanger : active && !selectMode ? C.bg3 : hover ? C.bg1 : 'transparent',
        padding: '9px 12px 9px 9px',
        cursor: 'pointer',
        borderBottom: `1px solid ${C.border}`,
        boxSizing: 'border-box',
        outline: 'none',
      }}
    >
      {selectMode && (
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            marginTop: 2,
            width: 15,
            height: 15,
            borderRadius: 4,
            border: `1px solid ${picked ? C.brand : C.border3}`,
            background: picked ? C.brand : C.bg1,
            color: '#fff',
            fontSize: 11,
            lineHeight: '13px',
            textAlign: 'center',
          }}
        >
          {picked ? '✓' : ''}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span
            title={row.title || row.id}
            style={{
              fontSize: 13,
              fontWeight: active && !selectMode ? 600 : 500,
              color: C.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {row.title || row.id}
          </span>
          {confirming ? null : (
            <span style={{ fontFamily: mono, fontSize: 11, color: C.ink3, flexShrink: 0 }}>
              {fmtClock(row.durationMs)}
            </span>
          )}
        </div>

        {confirming ? (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ fontSize: 11, color: C.danger, flex: 1 }}>
              {row.hasSummary ? '删除？LLM 总结会先归档' : '删除这条录音？不可恢复'}
            </span>
            <Btn small danger disabled={props.busy} onClick={props.onConfirmDelete}>
              {props.busy ? '删除中…' : '删除'}
            </Btn>
            <Btn small disabled={props.busy} onClick={props.onCancelDelete}>
              取消
            </Btn>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 5,
              fontSize: 11,
              color: C.ink3,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontFamily: mono }}>{fmtDay(row.createdAt)}</span>
            <span
              style={{
                padding: '0 6px',
                borderRadius: 4,
                background: C.bg3,
                color: C.ink2,
                lineHeight: '16px',
              }}
            >
              {SOURCE_LABEL[row.source] ?? row.source}
            </span>
            <span>{row.segments} 段</span>
            {row.titleSource === 'user' && <span title="手动命名">✎</span>}
            {row.titleSource === 'llm' && <span title="LLM 命名">✨</span>}
            {row.hasSummary && <span title="已有 LLM 总结（删除时会归档保留）">🧠</span>}
            {row.hasAudio && <span title="有音频">♪</span>}
            {row.hasMarkdown && <span title="有文档">📄</span>}
            {row.status === 'open' && <Chip tone="brand">进行中</Chip>}
            {!selectMode && (hover || active) && (
              <button
                type="button"
                title="删除这条录音"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onAskDelete()
                }}
                style={{
                  marginLeft: 'auto',
                  border: 'none',
                  background: 'transparent',
                  color: C.ink3,
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                  padding: '2px 4px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}
        {row.transcriptLength === 0 && !confirming && (
          <div style={{ fontSize: 11, color: C.warn, marginTop: 4 }}>无转写文本</div>
        )}
      </span>
    </div>
  )
}

// ─────────────────────────── 详情 ───────────────────────────

function SessionDetail(props: {
  detail: DetailPayload
  seekRef: React.MutableRefObject<((sec: number) => void) | null>
  confirmingDelete: boolean
  deleting: boolean
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onRenamed: (rec: SessionRecord) => void
}): React.ReactElement {
  const rec = props.detail.session
  const arts = props.detail.artifacts
  const [docTab, setDocTab] = React.useState<'transcript' | 'markdown' | 'notes'>('transcript')

  // 纪要：由 Agent 调用 recorder_attach_notes 工具关联进来的 Markdown。
  // 与「Markdown 文档」的区别：后者是本插件自动生成的转写稿，
  // 前者是 Agent 整理过的成果（一段录音可能对应多份）。
  interface NoteDoc {
    slug: string
    title: string
    path: string
    bytes: number
    updatedAt: string
  }
  const [notes, setNotes] = React.useState<NoteDoc[]>([])
  const [openNote, setOpenNote] = React.useState<{ path: string; text: string } | null>(null)
  React.useEffect(() => {
    let alive = true
    setOpenNote(null)
    void (async () => {
      try {
        const r = await get<{ docs: NoteDoc[] }>(`/notes-for?sessionId=${encodeURIComponent(rec.id)}`)
        if (alive) setNotes(r.docs ?? [])
      } catch {
        if (alive) setNotes([])
      }
    })()
    return () => {
      alive = false
    }
  }, [rec.id])

  const loadNote = React.useCallback(async (path: string) => {
    try {
      const r = await get<{ text: string }>(`/note?path=${encodeURIComponent(path)}`)
      setOpenNote({ path, text: r.text })
    } catch (e) {
      setOpenNote({ path, text: `读取失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }, [])

  // 标题：就地编辑 + 改完立刻把磁盘上的音频/Markdown 一起改名
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(rec.title ?? '')
  const [saving, setSaving] = React.useState(false)
  const [titleErr, setTitleErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    setEditing(false)
    setDraft(rec.title ?? '')
    setTitleErr(null)
  }, [rec.id, rec.title])

  const commit = async (): Promise<void> => {
    const next = draft.trim()
    if (!next || next === rec.title) {
      setEditing(false)
      return
    }
    setSaving(true)
    setTitleErr(null)
    try {
      const r = await setTitle(rec.id, next, 'user')
      props.onRenamed(r.session)
      setEditing(false)
    } catch (e) {
      setTitleErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const grouped = React.useMemo(() => groupBySpeaker(rec), [rec])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 头部 */}
      <header
        style={{
          padding: '12px 18px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {editing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commit()
                  else if (e.key === 'Escape') {
                    setEditing(false)
                    setDraft(rec.title ?? '')
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  maxWidth: 420,
                  border: `1px solid ${C.brand}`,
                  background: C.bg1,
                  color: C.ink,
                  borderRadius: 6,
                  padding: '4px 9px',
                  fontSize: 15,
                  fontWeight: 600,
                  outline: 'none',
                }}
              />
              <Btn small primary disabled={saving} onClick={() => void commit()}>
                {saving ? '保存中…' : '保存'}
              </Btn>
              <Btn
                small
                disabled={saving}
                onClick={() => {
                  setEditing(false)
                  setDraft(rec.title ?? '')
                }}
              >
                取消
              </Btn>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                title={rec.title ?? rec.id}
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: C.ink,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {rec.title || rec.id}
              </span>
              <button
                type="button"
                title="重命名（同时改磁盘上的音频与 Markdown 文件名）"
                onClick={() => {
                  setDraft(rec.title ?? '')
                  setEditing(true)
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: C.ink3,
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '2px 4px',
                  flexShrink: 0,
                }}
              >
                ✎
              </button>
              {rec.titleSource === 'llm' && <Chip tone="brand">LLM 命名</Chip>}
              {rec.titleSource === 'auto' && <Chip>自动命名</Chip>}
            </div>
          )}
          {titleErr && <div style={{ fontSize: 11, color: C.danger, marginTop: 4 }}>{titleErr}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            <Chip>{fmtDateTime(rec.createdAt)}</Chip>
            <Chip>{SOURCE_LABEL[rec.source] ?? rec.source}</Chip>
            <Chip>{fmtClock(rec.durationMs)}</Chip>
            {rec.model && <Chip>{rec.model}</Chip>}
            {rec.device_ && <Chip>{rec.device_}</Chip>}
            {typeof rec.speakerCount === 'number' && rec.speakerCount > 0 && (
              <Chip>{rec.speakerCount} 位说话人</Chip>
            )}
            {rec.deviceFile && <Chip title={rec.deviceFile}>设备文件</Chip>}
            <Chip tone={arts.audio.present ? 'ok' : 'warn'}>
              {arts.audio.present ? `音频 ${fmtBytes(arts.audio.bytes ?? 0)}` : '无音频'}
            </Chip>
            {/* 流转标记：这条录音有没有被交给过 LLM（总结或投放都算） */}
            {(props.detail.flows?.length ?? 0) > 0 ? (
              <Chip
                tone="brand"
                title={(props.detail.flows ?? [])
                  .map((f) => {
                    const kind = f.kind === 'summary' ? '总结' : f.kind === 'auto' ? '自动流转' : '投放'
                    const batch = (f.batchSize ?? 1) > 1 ? `（同批 ${f.batchSize} 条）` : ''
                    return `${kind}${batch} → ${f.targetSessionId.slice(0, 20)}…  ${new Date(f.at).toLocaleString()}`
                  })
                  .join('\n')}
              >
                已流转给 LLM
                {(props.detail.flows?.length ?? 0) > 1 ? ` ×${props.detail.flows?.length}` : ''}
              </Chip>
            ) : (
              <Chip title="还没有交给过 Agent（总结或投放）">未流转</Chip>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {arts.markdown.present && (
            <a
              href={markdownUrl(rec.id)}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: 12,
                color: C.brand,
                textDecoration: 'none',
                border: `1px solid ${C.border3}`,
                borderRadius: 6,
                padding: '4px 10px',
              }}
            >
              打开 Markdown
            </a>
          )}
          {arts.audio.present && (
            <a
              href={audioUrl(rec.id)}
              download={downloadName(rec, extOf(rec.audio?.file ?? 'audio.ogg'))}
              style={{
                fontSize: 12,
                color: C.brand,
                textDecoration: 'none',
                border: `1px solid ${C.border3}`,
                borderRadius: 6,
                padding: '4px 10px',
              }}
            >
              下载音频
            </a>
          )}
          {!props.confirmingDelete && (
            <Btn small danger onClick={props.onAskDelete} title="删除这条录音（连同音频与文档）">
              删除
            </Btn>
          )}
        </div>
      </header>

      {/* 删除确认条：不可恢复的操作必须挡一道 */}
      {props.confirmingDelete && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 18px',
            background: C.hoverDanger,
            borderBottom: `1px solid ${C.danger}`,
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12.5, color: C.danger, flex: 1, minWidth: 200, lineHeight: 1.7 }}>
            删除「{rec.title || rec.id}」？会连同磁盘上的
            {arts.audio.present ? `音频（${fmtBytes(arts.audio.bytes ?? 0)}）` : '音频'}
            {arts.markdown.present ? '与 Markdown 文档' : ''}
            一起删掉，
            <strong>不可恢复</strong>。
          </span>
          <Btn small danger disabled={props.deleting} onClick={props.onConfirmDelete}>
            {props.deleting ? '删除中…' : '确认删除'}
          </Btn>
          <Btn small disabled={props.deleting} onClick={props.onCancelDelete}>
            取消
          </Btn>
        </div>
      )}

      {rec.error && (
        <div style={{ padding: '10px 18px 0' }}>
          <ErrorBar text={`该录音处理失败：${rec.error}`} />
        </div>
      )}

      {/* 上：录音 */}
      <div style={{ padding: '14px 18px 0', flexShrink: 0 }}>
        {arts.audio.present ? (
          <AudioPlayer
            src={audioUrl(rec.id)}
            fallbackDurationMs={rec.durationMs}
            downloadName={downloadName(rec, extOf(rec.audio?.file ?? 'audio.ogg'))}
            seekRef={props.seekRef}
          />
        ) : (
          <div
            style={{
              border: `1px dashed ${C.border3}`,
              borderRadius: 10,
              padding: 16,
              textAlign: 'center',
              color: C.ink3,
              fontSize: 12,
            }}
          >
            这条录音没有保留音频（配置里「归档音频」已关闭，或音频未落盘）
          </div>
        )}
      </div>

      {/* 下：文档 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '14px 18px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, flexShrink: 0 }}>
          <TabButton active={docTab === 'transcript'} onClick={() => setDocTab('transcript')}>
            转写原文
          </TabButton>
          {arts.markdown.present && (
            <TabButton active={docTab === 'markdown'} onClick={() => setDocTab('markdown')}>
              Markdown 文档
            </TabButton>
          )}
          {/* 常驻显示：只在有纪要时才出现的话，用户不知道它将来会出现在哪 */}
          <TabButton active={docTab === 'notes'} onClick={() => setDocTab('notes')}>
            纪要查看{notes.length > 0 ? ` (${notes.length})` : ''}
          </TabButton>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: C.ink3 }}>
            {rec.segments.length > 0 ? `${rec.segments.length} 个分段` : ''}
          </span>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            background: C.bg2,
            padding: '6px 4px',
          }}
        >
          {docTab === 'transcript' ? (
            rec.segments.length === 0 ? (
              <Empty>
                {rec.transcript.trim()
                  ? rec.transcript
                  : rec.error
                    ? '识别失败，没有转写文本'
                    : '还没有转写文本'}
              </Empty>
            ) : (
              grouped.map((block, i) => (
                <div key={i} style={{ padding: '8px 14px' }}>
                  {block.speaker !== undefined && (
                    <div
                      style={{
                        fontSize: 11,
                        color: C.ink3,
                        marginBottom: 3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: speakerColor(block.speaker),
                        }}
                      />
                      说话人 {block.speaker + 1}
                    </div>
                  )}
                  {block.items.map((seg, j) => (
                    <div
                      key={j}
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                        padding: '2px 0',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => props.seekRef.current?.(seg.start / 1000)}
                        title="跳到这一段"
                        disabled={!arts.audio.present}
                        style={{
                          flexShrink: 0,
                          border: 'none',
                          background: 'transparent',
                          color: C.brand,
                          fontFamily: mono,
                          fontSize: 11,
                          cursor: arts.audio.present ? 'pointer' : 'default',
                          padding: '1px 0',
                          opacity: arts.audio.present ? 1 : 0.5,
                          minWidth: 42,
                          textAlign: 'left',
                        }}
                      >
                        {fmtClock(seg.start)}
                      </button>
                      <span style={{ fontSize: 13.5, lineHeight: 1.85, color: C.ink, flex: 1 }}>
                        {seg.text}
                      </span>
                    </div>
                  ))}
                </div>
              ))
            )
          ) : docTab === 'markdown' ? (
            <MarkdownView sessionId={rec.id} />
          ) : /* 纪要查看 */ notes.length === 0 ? (
            <Empty>
              还没有纪要。用「纪要整理」模板把这条录音交给 Agent 后，Agent 会把整理好的文档关联到这里。
            </Empty>
          ) : openNote === null ? (
            <div style={{ padding: '6px 10px' }}>
              {notes.map((n) => (
                <button
                  key={n.path}
                  type="button"
                  onClick={() => void loadNote(n.path)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 10px',
                    marginBottom: 6,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    background: C.bg1,
                    color: C.ink,
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                  <div style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>
                    {fmtBytes(n.bytes)} · {new Date(n.updatedAt).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Btn small onClick={() => setOpenNote(null)}>
                  返回列表
                </Btn>
                <span style={{ fontSize: 12, color: C.ink3 }}>
                  {notes.find((n) => n.path === openNote.path)?.title ?? ''}
                </span>
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 13,
                  lineHeight: 1.75,
                  font: 'inherit',
                }}
              >
                {openNote.text}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TabButton(props: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        border: 'none',
        background: 'transparent',
        color: props.active ? C.ink : C.ink3,
        fontSize: 13,
        fontWeight: props.active ? 600 : 400,
        padding: '4px 10px',
        cursor: 'pointer',
        borderBottom: `2px solid ${props.active ? C.brand : 'transparent'}`,
      }}
    >
      {props.children}
    </button>
  )
}

/** Markdown 原文按等宽展示：这一层只做「看原文」，真正的渲染交给 Markdown 阅读器。 */
function MarkdownView(props: { sessionId: string }): React.ReactElement {
  const [text, setText] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    setText(null)
    setError(null)
    void fetch(markdownUrl(props.sessionId))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => {
        if (alive) setText(t)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [props.sessionId])

  if (error) return <Empty>读取失败：{error}</Empty>
  if (text === null) return <Loading />
  return (
    <pre
      style={{
        margin: 0,
        padding: '10px 14px',
        fontFamily: mono,
        fontSize: 12,
        lineHeight: 1.8,
        color: C.ink2,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </pre>
  )
}

// ─────────────────────────── 辅助 ───────────────────────────

interface SpeakerBlock {
  speaker?: number
  items: { start: number; end: number; text: string }[]
}

/** 把连续同一说话人的分段并成一块，读起来像对话稿而不是流水账。 */
function groupBySpeaker(rec: SessionRecord): SpeakerBlock[] {
  const blocks: SpeakerBlock[] = []
  for (const seg of rec.segments) {
    const text = (seg.text ?? '').trim()
    if (!text) continue
    const last = blocks[blocks.length - 1]
    if (last && last.speaker === seg.speaker) {
      last.items.push({ start: seg.start, end: seg.end, text })
    } else {
      blocks.push({ speaker: seg.speaker, items: [{ start: seg.start, end: seg.end, text }] })
    }
  }
  return blocks
}

const SPEAKER_COLORS = ['#4a7cff', '#e8491d', '#1a8a4a', '#8a4aff', '#b06a00', '#0aa3a3']

function speakerColor(n: number): string {
  return SPEAKER_COLORS[n % SPEAKER_COLORS.length]
}
