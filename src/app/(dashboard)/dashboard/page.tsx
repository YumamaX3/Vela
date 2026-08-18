'use client';

/**
 * 🏛️ Vela Dashboard Homepage
 *
 * The main landing page for the Vela AI gateway — showing key metrics,
 * quick actions, and system health at a glance.
 */

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
// Dashboard components (JS files with no TS declarations)
import Card from '@/shared/components/Card.js';
const ProviderTopology = dynamic(() => import('@/app/(dashboard)/dashboard/usage/components/ProviderTopology.js'), { ssr: false });
const Sparkline = dynamic(() => import('@/shared/components/Sparkline.js'), { ssr: false });

/**
 * HeroStat — Stats displayed in the hero gradient band
 */
function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-black/10 backdrop-blur-sm px-3.5 py-3">
      <p className="text-white/75 text-[11px] font-medium truncate">{label}</p>
      <p className="text-white text-xl font-semibold tracking-tight mt-0.5 tabular-nums">
        {value}
      </p>
    </div>
  );
}

/**
 * StatCard — Individual stat card for detailed view
 */
interface StatCardProps {
  icon: string;
  label: string;
  value: string;
  trend?: number; // percentage change
  color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
}

function StatCard({ icon, label, value, trend, color = 'primary' }: StatCardProps) {
  const colorClasses = {
    primary: 'bg-brand-500/10 text-brand-600 dark:text-brand-400',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    error: 'bg-error/10 text-error',
    info: 'bg-info/10 text-info',
  };

  return (
    <Card hover elev padding="md" className="group">
      <div className="flex items-start justify-between mb-2">
        <div className={`p-2 rounded-[10px] ${colorClasses[color]}`}>
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-medium ${trend >= 0 ? 'text-success' : 'text-error'}`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-text-muted text-sm font-medium mb-1">{label}</p>
      <p className="text-text-main text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

/**
 * QuickActionCard — Primary action buttons
 */
interface QuickActionCardProps {
  icon: string;
  title: string;
  description: string;
  href: string;
}

function QuickActionCard({ icon, title, description, href }: QuickActionCardProps) {
  return (
    <a href={href} className="block group">
      <Card hover elev padding="lg" className="h-full transition-transform duration-200 group-hover:-translate-y-0.5">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-[10px] bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
            <span className="material-symbols-outlined text-[24px]">{icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-text-main font-semibold mb-1 group-hover:text-primary transition-colors">
              {title}
            </h3>
            <p className="text-text-muted text-sm">{description}</p>
          </div>
          <span className="material-symbols-outlined text-text-subtle group-hover:text-primary transition-colors">
            arrow_forward
          </span>
        </div>
      </Card>
    </a>
  );
}

/**
 * ActivityItem — Single activity row item
 */
interface ActivityItemProps {
  time: string;
  action: string;
  provider: string;
  status: 'success' | 'error' | 'pending';
}

function ActivityItem({ time, action, provider, status }: ActivityItemProps) {
  const statusColors = {
    success: 'bg-success',
    error: 'bg-error',
    pending: 'bg-warning',
  };

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-0">
      <div className={`w-2 h-2 rounded-full ${statusColors[status]} animate-pulse`}></div>
      <div className="flex-1 min-w-0">
        <p className="text-text-main text-sm font-medium truncate">{action}</p>
        <p className="text-text-muted text-xs truncate">{provider}</p>
      </div>
      <div className="text-text-subtle text-xs whitespace-nowrap">{time}</div>
    </div>
  );
}

/**
 * Main Dashboard Page Component
 */
export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalRequests: 1847,
    activeProviders: 42,
    cacheRate: 78.4,
    avgLatency: 142,
  });

  const [recentActivity, setRecentActivity] = useState([
    { time: '2m ago', action: 'Request completed', provider: 'openai/gpt-4o', status: 'success' as const },
    { time: '3m ago', action: 'Cache miss', provider: 'anthropic/claude-3', status: 'pending' as const },
    { time: '5m ago', action: 'Rate limit hit', provider: 'google/gemini-pro', status: 'error' as const },
    { time: '7m ago', action: 'Request completed', provider: 'mistral/mistral-large', status: 'success' as const },
  ]);

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(prev => ({
        ...prev,
        totalRequests: prev.totalRequests + Math.floor(Math.random() * 5),
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Sample data for sparkline
  const requestTrend = [120, 180, 150, 220, 190, 280, 240, 320, 290, 380, 350, 420];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-semibold text-text-main">Dashboard</h1>
          <p className="text-text-muted mt-1">Welcome back — here&apos;s what&apos;s happening with your gateways</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inline-flex w-full h-full bg-success rounded-full opacity-75 animate-ping"></span>
              <span className="relative inline-flex w-2.5 h-2.5 bg-success rounded-full"></span>
            </span>
            System healthy
          </span>
          <span className="text-text-subtle">• Updated just now</span>
        </div>
      </div>

      {/* Hero Band with Stats */}
      <div className="relative overflow-hidden rounded-[14px] border border-brand-500/20 bg-gradient-to-br from-brand-500 via-brand-400 to-brand-300 shadow-[var(--shadow-warm)] p-6">
        {/* Decorative background */}
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-2xl"></div>
        <div className="absolute -bottom-20 right-32 w-48 h-48 rounded-full bg-white/10 blur-2xl"></div>

        {/* Title */}
        <div className="relative z-10 mb-6">
          <h2 className="text-white text-xl font-semibold">Gateway Overview</h2>
          <p className="text-white/85 text-sm mt-1">Real-time pulse across all providers</p>
        </div>

        {/* Stats Grid */}
        <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat label="Total requests" value={stats.totalRequests.toLocaleString()} />
          <HeroStat label="Active providers" value={stats.activeProviders.toString()} />
          <HeroStat label="Cache rate" value={`${stats.cacheRate}%`} />
          <HeroStat label="Avg latency" value={`${stats.avgLatency}ms`} />
        </div>

        {/* Live indicator */}
        <div className="relative z-10 mt-4 flex items-center gap-2 text-white/90 text-xs">
          <span className="flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full bg-white rounded-full opacity-75 animate-ping"></span>
            <span className="relative inline-flex w-2 h-2 bg-white rounded-full"></span>
          </span>
          <span>Live updates enabled</span>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {/* Left Column — Main content */}
        <div className="space-y-6">
          {/* Top Actions Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <QuickActionCard
              icon="add_circle"
              title="Add Provider"
              description="Connect a new AI provider"
              href="/providers/new"
            />
            <QuickActionCard
              icon="settings"
              title="Proxy Pools"
              description="Manage proxy rotation"
              href="/proxy-pools"
            />
            <QuickActionCard
              icon="key"
              title="API Keys"
              description="Create & manage keys"
              href="/api-keys"
            />
            <QuickActionCard
              icon="analytics"
              title="Analytics"
              description="View usage insights"
              href="/usage"
            />
          </div>

          {/* Provider Health Topology */}
          <Card title="Provider Topology" subtitle="Visual map of provider connectivity" elev padding="lg">
            <div className="h-[320px]">
              <ProviderTopology />
            </div>
          </Card>

          {/* Request Trend Chart */}
          <Card title="Request Trend" subtitle="Last 12 hours of activity" padding="lg">
            <div className="h-[180px]">
              <Sparkline data={requestTrend} />
            </div>
          </Card>
        </div>

        {/* Right Column — Sidebar content */}
        <div className="space-y-6">
          {/* Recent Activity Feed */}
          <Card title="Recent Activity" padding="lg">
            <div className="divide-y divide-border-subtle">
              {recentActivity.map((item, index) => (
                <ActivityItem key={index} {...item} />
              ))}
            </div>
            <button className="w-full mt-3 text-sm text-primary hover:text-brand-600 dark:hover:text-brand-400 font-medium transition-colors">
              View all activity →
            </button>
          </Card>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 gap-4">
            <StatCard
              icon="people"
              label="Team members"
              value="8"
              trend={12}
              color="info"
            />
            <StatCard
              icon="storage"
              label="Storage used"
              value="2.4 GB"
              trend={8}
              color="warning"
            />
            <StatCard
              icon="security"
              label="Security score"
              value="94/100"
              trend={3}
              color="success"
            />
          </div>

          {/* System Status */}
          <Card title="System Status" padding="lg">
            <div className="space-y-3">
              {[
                { label: 'Database', status: 'ok', desc: 'Connected • 2.3ms RTT' },
                { label: 'Redis Cache', status: 'ok', desc: 'Hit rate 78.4%' },
                { label: 'External API', status: 'ok', desc: 'All endpoints responding' },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-text-main font-medium text-sm">{item.label}</p>
                    <p className="text-text-muted text-xs">{item.desc}</p>
                  </div>
                  <span className={`w-2.5 h-2.5 rounded-full ${item.status === 'ok' ? 'bg-success' : 'bg-error'}`}></span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
