import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock3,
  Database as DatabaseIcon,
  FileText,
  KeyRound,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Table2,
  Wrench,
  XCircle,
} from 'lucide-react'
import { PageContainer } from '@/components/ui/page-container'
import { cn } from '@/lib/utils'

type DbTableStatus = {
  name: string
  exists: boolean
}

type DbStatus = {
  version: string | null
  expectedVersion: string
  isCurrent: boolean
  tables: DbTableStatus[]
  counts: {
    channels: number | null
    tokens: number | null
    periodUsageRows: number | null
    settings: number | null
  }
}

type InitResult = {
  success?: boolean
  data?: string
  error?: string
  completedAt: number
}

const tableLabels: Record<string, string> = {
  channel_config: '频道配置',
  api_token: 'API 令牌',
  api_token_usage_period: '周期用量',
  settings: '系统设置',
}

const formatCount = (value: number | null | undefined) => {
  if (value == null) return '不可用'
  return value.toLocaleString()
}

const formatTime = (timestamp: number) => {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
}

export function Database() {
  const [result, setResult] = useState<InitResult | null>(null)
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: ['database-status'],
    queryFn: async () => {
      const response = await apiClient.getDatabaseStatus()
      return response.data as DbStatus
    },
  })

  const initMutation = useMutation({
    mutationFn: async () => {
      return apiClient.initDatabase()
    },
    onSuccess: (data: any) => {
      setResult({ ...data, completedAt: Date.now() })
      queryClient.invalidateQueries({ queryKey: ['database-status'] })
      addToast('数据库初始化成功', 'success')
    },
    onError: (error: any) => {
      setResult({ error: error.message, completedAt: Date.now() })
      queryClient.invalidateQueries({ queryKey: ['database-status'] })
      addToast('数据库初始化失败：' + error.message, 'error')
    },
  })

  const status = statusQuery.data
  const missingTables = useMemo(() => {
    return status?.tables.filter((table) => !table.exists) || []
  }, [status])
  const isHealthy = !!status && status.isCurrent && missingTables.length === 0
  const statusLabel = statusQuery.isLoading
    ? '检测中'
    : isHealthy
      ? '正常'
      : '需处理'

  const metrics = [
    {
      label: '频道',
      value: formatCount(status?.counts.channels),
      icon: Layers3,
      tone: 'text-info',
    },
    {
      label: '令牌',
      value: formatCount(status?.counts.tokens),
      icon: KeyRound,
      tone: 'text-primary',
    },
    {
      label: '周期用量',
      value: formatCount(status?.counts.periodUsageRows),
      icon: Activity,
      tone: 'text-warning',
    },
    {
      label: '设置项',
      value: formatCount(status?.counts.settings),
      icon: FileText,
      tone: 'text-success',
    },
  ]

  const handleInit = () => {
    if (confirm('确定要初始化数据库吗？此操作将创建或迁移必要的表结构。')) {
      initMutation.mutate()
    }
  }

  return (
    <PageContainer
      title="数据库管理"
      description="D1 结构状态、版本迁移和初始化"
      actions={
        <>
          <Button
            variant="outline"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching || initMutation.isPending}
          >
            <RefreshCw className={cn('h-4 w-4', statusQuery.isFetching && 'animate-spin')} />
            刷新
          </Button>
          <Button onClick={handleInit} disabled={initMutation.isPending}>
            {initMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Wrench className="h-4 w-4" />
            )}
            初始化 / 迁移
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Card className={cn(
          'overflow-hidden',
          isHealthy ? 'border-success/30' : 'border-warning/40'
        )}>
          <CardContent className="p-0">
            <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border',
                      isHealthy
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-warning/30 bg-warning/10 text-warning'
                    )}>
                      {isHealthy ? (
                        <ShieldCheck className="h-5 w-5" />
                      ) : (
                        <DatabaseIcon className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">D1 结构状态</h3>
                        <Badge variant={isHealthy ? 'success' : 'warning'}>
                          {statusLabel}
                        </Badge>
                      </div>
                      <p className="max-w-2xl text-sm text-muted-foreground">
                        当前版本 {status?.version || '未初始化'}，目标版本 {status?.expectedVersion || '未知'}。
                      </p>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-3.5 w-3.5" />
                      {statusQuery.dataUpdatedAt
                        ? `更新于 ${formatTime(statusQuery.dataUpdatedAt)}`
                        : '等待检测'}
                    </div>
                  </div>
                </div>

                {!isHealthy && (
                  <div className="mt-5 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      {statusQuery.isError
                        ? '无法读取数据库状态，请检查管理员令牌或 Worker 日志。'
                        : missingTables.length > 0
                          ? `缺少 ${missingTables.length} 张表，执行初始化 / 迁移即可补齐。`
                          : '数据库版本未达到目标版本，执行初始化 / 迁移即可升级。'}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t bg-muted/20 p-6 lg:border-l lg:border-t-0">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  版本
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-background p-3">
                    <div className="text-xs text-muted-foreground">当前</div>
                    <div className="mt-1 font-mono text-sm font-semibold">{status?.version || '-'}</div>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <div className="text-xs text-muted-foreground">目标</div>
                    <div className="mt-1 font-mono text-sm font-semibold">{status?.expectedVersion || '-'}</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon
            return (
              <Card key={metric.label}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">{metric.label}</div>
                      <div className="mt-1 text-xl font-semibold tabular-nums">{metric.value}</div>
                    </div>
                    <Icon className={cn('h-5 w-5', metric.tone)} />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.9fr]">
          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">表结构</h3>
                  <p className="mt-1 text-sm text-muted-foreground">初始化会补齐缺失结构，不会清空数据。</p>
                </div>
                <Table2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="divide-y rounded-lg border">
                {(status?.tables || []).map((table) => (
                  <div key={table.name} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium">{tableLabels[table.name] || table.name}</div>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">{table.name}</div>
                    </div>
                    <Badge variant={table.exists ? 'success' : 'warning'} className="shrink-0">
                      {table.exists ? (
                        <CheckCircle className="mr-1 h-3 w-3" />
                      ) : (
                        <XCircle className="mr-1 h-3 w-3" />
                      )}
                      {table.exists ? '存在' : '缺失'}
                    </Badge>
                  </div>
                ))}
                {!status?.tables?.length && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    暂无状态数据
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">最近操作</h3>
                  <p className="mt-1 text-sm text-muted-foreground">初始化接口返回的最后结果。</p>
                </div>
                {result?.error ? (
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                ) : (
                  <CheckCircle className={cn('h-5 w-5', result ? 'text-success' : 'text-muted-foreground')} />
                )}
              </div>

              {result ? (
                <div className={cn(
                  'rounded-lg border p-4',
                  result.error ? 'border-destructive/30 bg-destructive/10' : 'border-success/30 bg-success/10'
                )}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <Badge variant={result.error ? 'destructive' : 'success'}>
                      {result.error ? '失败' : '成功'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatTime(result.completedAt)}</span>
                  </div>
                  <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs text-slate-100">
                    {JSON.stringify(result.error ? { error: result.error } : result, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="flex h-[220px] flex-col items-center justify-center rounded-lg border border-dashed text-center text-muted-foreground">
                  <DatabaseIcon className="mb-3 h-8 w-8 opacity-50" />
                  <div className="text-sm">尚未执行初始化</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}
