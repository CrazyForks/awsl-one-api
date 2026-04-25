import { useMemo } from 'react'
import type { ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Activity, ArrowRight, BarChart3, Database, Gauge, Key, Link as LinkIcon, Lock, Server, Shield, TestTube2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/auth'
import { Link } from 'react-router-dom'
import { apiClient } from '@/api/client'
import { Channel, ChannelConfig, Token, TokenConfig } from '@/types'
import { cn, formatCurrency } from '@/lib/utils'

const parseConfig = <T,>(value: string | T): T | null => {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  'azure-openai': 'Azure',
  'openai-audio': 'OpenAI Audio',
  'azure-openai-audio': 'Azure Audio',
  claude: 'Claude',
  'claude-to-openai': 'Claude Compat',
  'openai-responses': 'Responses',
  'azure-openai-responses': 'Azure Responses',
}

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'primary',
}: {
  title: string
  value: string
  detail: string
  icon: ComponentType<{ className?: string }>
  tone?: 'primary' | 'success' | 'warning' | 'info'
}) {
  const toneClass = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
  }[tone]

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
          </div>
          <div className={cn('rounded-md p-2', toneClass)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const { isAuthenticated, openAuthModal } = useAuthStore()

  const channelsQuery = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const response = await apiClient.getChannels()
      return response.data as Channel[]
    },
    enabled: isAuthenticated,
  })

  const tokensQuery = useQuery({
    queryKey: ['tokens'],
    queryFn: async () => {
      const response = await apiClient.getTokens()
      return response.data as Token[]
    },
    enabled: isAuthenticated,
  })

  const summary = useMemo(() => {
    const channels = channelsQuery.data || []
    const tokens = tokensQuery.data || []
    const parsedChannels = channels
      .map((channel) => parseConfig<ChannelConfig>(channel.value))
      .filter((config): config is ChannelConfig => !!config)
    const parsedTokens = tokens
      .map((token) => ({
        token,
        config: parseConfig<TokenConfig>(token.value),
      }))
      .filter((item): item is { token: Token; config: TokenConfig } => !!item.config)

    const providerCounts = parsedChannels.reduce<Record<string, number>>((acc, config) => {
      const label = providerLabels[config.type] || config.type || 'Unknown'
      acc[label] = (acc[label] || 0) + 1
      return acc
    }, {})

    const totalUsage = parsedTokens.reduce((sum, item) => sum + (item.token.usage || 0), 0)
    const totalQuota = parsedTokens.reduce((sum, item) => sum + (item.config.total_quota || 0), 0)
    const boundTokens = parsedTokens.filter((item) => (item.config.channel_keys || []).length > 0).length

    return {
      channels: parsedChannels.length,
      invalidChannels: channels.length - parsedChannels.length,
      tokens: parsedTokens.length,
      invalidTokens: tokens.length - parsedTokens.length,
      providerCounts,
      totalUsage,
      totalQuota,
      boundTokens,
      quotaPercent: totalQuota > 0 ? Math.min(100, (totalUsage / totalQuota) * 100) : 0,
    }
  }, [channelsQuery.data, tokensQuery.data])

  const isLoading = channelsQuery.isLoading || tokensQuery.isLoading
  const hasSummaryError = channelsQuery.isError || tokensQuery.isError

  return (
    <div className="p-4 md:p-5 lg:p-6 animate-in">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">控制台</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI 网关配置、配额和测试入口</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/api-test">
              <TestTube2 className="h-4 w-4" />
              API 测试
            </Link>
          </Button>
          {isAuthenticated ? (
            <Button size="sm" asChild>
              <Link to="/channels">
                <LinkIcon className="h-4 w-4" />
                管理频道
              </Link>
            </Button>
          ) : (
            <Button size="sm" onClick={openAuthModal}>
              <Lock className="h-4 w-4" />
              管理员登录
            </Button>
          )}
        </div>
      </div>

      {!isAuthenticated ? (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold">Awsl One API</div>
                  <div className="text-xs text-muted-foreground">统一 AI 网关管理后台</div>
                </div>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                登录后可查看频道、令牌和配额状态。未登录时仍可进入 API 测试页，用已有业务令牌验证转发链路。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={openAuthModal}>
                  <Lock className="h-4 w-4" />
                  管理员登录
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/api-test">
                    测试 API
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="mb-3 text-sm font-semibold">可用代理端点</div>
              <div className="space-y-2">
                {['/v1/chat/completions', '/v1/messages', '/v1/responses', '/v1/audio/speech'].map((endpoint) => (
                  <div key={endpoint} className="rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                    {endpoint}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="频道"
              value={hasSummaryError || isLoading ? '-' : String(summary.channels)}
              detail={hasSummaryError ? '读取失败' : summary.invalidChannels > 0 ? `${summary.invalidChannels} 条配置异常` : '可用于请求路由'}
              icon={Server}
              tone={hasSummaryError || summary.invalidChannels > 0 ? 'warning' : 'primary'}
            />
            <StatCard
              title="令牌"
              value={hasSummaryError || isLoading ? '-' : String(summary.tokens)}
              detail={hasSummaryError ? '读取失败' : `${summary.boundTokens} 个限制频道范围`}
              icon={Key}
              tone={hasSummaryError ? 'warning' : 'success'}
            />
            <StatCard
              title="用量"
              value={hasSummaryError || isLoading ? '-' : formatCurrency(summary.totalUsage)}
              detail={hasSummaryError ? '读取失败' : `总配额 ${formatCurrency(summary.totalQuota)}`}
              icon={BarChart3}
              tone={hasSummaryError || summary.quotaPercent > 80 ? 'warning' : 'info'}
            />
            <StatCard
              title="健康"
              value={hasSummaryError ? '异常' : summary.invalidTokens + summary.invalidChannels > 0 ? '检查' : '正常'}
              detail={hasSummaryError ? '管理数据读取失败' : `${summary.invalidTokens + summary.invalidChannels} 条解析异常`}
              icon={Shield}
              tone={hasSummaryError || summary.invalidTokens + summary.invalidChannels > 0 ? 'warning' : 'success'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardContent className="p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">服务商分布</div>
                    <div className="text-xs text-muted-foreground">来自频道配置的静态摘要</div>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/channels">查看频道</Link>
                  </Button>
                </div>
                <div className="space-y-2">
                  {hasSummaryError ? (
                    <div className="rounded-md border border-dashed p-5 text-center text-sm text-warning">
                      管理数据读取失败，请刷新或重新登录
                    </div>
                  ) : Object.keys(summary.providerCounts).length === 0 ? (
                    <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
                      暂无频道配置
                    </div>
                  ) : (
                    Object.entries(summary.providerCounts).map(([provider, count]) => (
                      <div key={provider} className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-primary" />
                          <span className="text-sm font-medium">{provider}</span>
                        </div>
                        <span className="font-mono text-sm text-muted-foreground">{count}</span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="mb-4 text-sm font-semibold">配额水位</div>
                <div className="mb-2 flex items-end justify-between">
                  <span className="text-2xl font-semibold">{summary.quotaPercent.toFixed(0)}%</span>
                  <span className="text-xs text-muted-foreground">{formatCurrency(summary.totalUsage)} / {formatCurrency(summary.totalQuota)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      summary.quotaPercent > 90 ? 'bg-destructive' : summary.quotaPercent > 70 ? 'bg-warning' : 'bg-primary'
                    )}
                    style={{ width: `${summary.quotaPercent}%` }}
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/tokens">
                      <Key className="h-4 w-4" />
                      令牌
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/database">
                      <Database className="h-4 w-4" />
                      数据库
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              { icon: Gauge, title: '路由配置', desc: '维护模型映射和服务商端点', href: '/channels' },
              { icon: Activity, title: '调用验证', desc: '快速验证业务令牌请求链路', href: '/api-test' },
              { icon: BarChart3, title: '定价规则', desc: '检查模型输入、输出和请求成本', href: '/pricing' },
            ].map((item) => (
              <Link key={item.href} to={item.href} className="group rounded-lg border bg-card p-4 shadow-soft transition-colors hover:bg-muted/30">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
                  <item.icon className="h-4 w-4" />
                </div>
                <div className="text-sm font-semibold">{item.title}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
