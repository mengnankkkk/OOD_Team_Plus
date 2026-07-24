-- Money Whisperer 财语 · 主数据模型
-- 所有表按 user_id 严格隔离，服务端强制切分

-- 1. 用户档案：家庭、现金流、风险画像
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  age INTEGER,
  household TEXT,
  monthly_income NUMERIC(14,2),
  monthly_expense NUMERIC(14,2),
  liabilities NUMERIC(14,2),
  emergency_target_months INTEGER DEFAULT 6,
  risk_level TEXT CHECK (risk_level IN ('R1','R2','R3','R4','R5')) DEFAULT 'R3',
  risk_subjective TEXT,
  risk_capacity TEXT,
  behavior_notes TEXT,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_delete_own" ON public.profiles FOR DELETE USING (auth.uid() = id);

-- 2. 目标
CREATE TABLE public.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT CHECK (category IN ('house','emergency','education','retirement','custom')) DEFAULT 'custom',
  target_amount NUMERIC(14,2) NOT NULL,
  current_amount NUMERIC(14,2) DEFAULT 0,
  target_date DATE,
  priority INTEGER DEFAULT 1,
  monthly_contribution NUMERIC(14,2),
  success_probability NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_goals_user ON public.goals(user_id, priority);
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goals_all_own" ON public.goals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. 账户
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_type TEXT CHECK (account_type IN ('bank','securities','fund_platform','pension','other')) DEFAULT 'other',
  currency TEXT DEFAULT 'CNY',
  balance NUMERIC(14,2) DEFAULT 0,
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_accounts_user ON public.accounts(user_id);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "accounts_all_own" ON public.accounts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. 持仓
CREATE TABLE public.holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  goal_id UUID REFERENCES public.goals(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_class TEXT CHECK (asset_class IN ('cash','money_market','bond_fund','equity_fund','stock','index_fund','other')) NOT NULL,
  industry TEXT,
  quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
  cost_basis NUMERIC(14,2) DEFAULT 0,
  current_price NUMERIC(14,4) DEFAULT 0,
  market_value NUMERIC(14,2) GENERATED ALWAYS AS (quantity * current_price) STORED,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_holdings_user ON public.holdings(user_id, asset_class);
CREATE INDEX idx_holdings_goal ON public.holdings(user_id, goal_id);
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holdings_all_own" ON public.holdings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. 自选
CREATE TABLE public.watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id UUID REFERENCES public.goals(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_class TEXT,
  reason TEXT,
  planned_horizon TEXT,
  drawdown_threshold NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_watchlist_user ON public.watchlist(user_id);
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "watchlist_all_own" ON public.watchlist FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. 建档对话记录
CREATE TABLE public.onboarding_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user','advisor','system')) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_onboarding_user ON public.onboarding_messages(user_id, created_at DESC);
ALTER TABLE public.onboarding_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "onboarding_all_own" ON public.onboarding_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. Agent 运行
CREATE TABLE public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  goal_id UUID REFERENCES public.goals(id) ON DELETE SET NULL,
  status TEXT CHECK (status IN ('running','succeeded','failed','blocked','cancelled')) DEFAULT 'running',
  planner_summary TEXT,
  agent_states JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);
CREATE INDEX idx_agent_runs_user ON public.agent_runs(user_id, started_at DESC);
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_runs_all_own" ON public.agent_runs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 8. 建议
CREATE TABLE public.recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  goal_id UUID REFERENCES public.goals(id) ON DELETE SET NULL,
  action TEXT CHECK (action IN ('increase','decrease','hold','observe','emergency_reserve')) NOT NULL,
  headline TEXT NOT NULL,
  target_symbol TEXT,
  target_asset_class TEXT,
  amount NUMERIC(14,2),
  weight NUMERIC(5,2),
  pace TEXT,
  driver TEXT NOT NULL,
  evidence JSONB DEFAULT '[]',
  counter_evidence JSONB DEFAULT '[]',
  effective_until DATE NOT NULL,
  expire_condition TEXT NOT NULL,
  risk_impact JSONB DEFAULT '{}',
  compliance_status TEXT CHECK (compliance_status IN ('approved','blocked','pending')) DEFAULT 'pending',
  compliance_notes TEXT,
  status TEXT CHECK (status IN ('active','simulated','revoked','expired','rejected')) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_recs_user ON public.recommendations(user_id, status, created_at DESC);
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recs_all_own" ON public.recommendations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 9. 证据包
CREATE TABLE public.evidence_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES public.recommendations(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  data_snapshots JSONB DEFAULT '[]',
  skill_runs JSONB DEFAULT '[]',
  workflow_dag JSONB DEFAULT '{}',
  research_metrics JSONB DEFAULT '{}',
  simulation_log JSONB DEFAULT '[]',
  risk_verdicts JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_evidence_user ON public.evidence_packs(user_id, created_at DESC);
CREATE INDEX idx_evidence_rec ON public.evidence_packs(recommendation_id);
ALTER TABLE public.evidence_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence_all_own" ON public.evidence_packs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 10. 提醒
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES public.recommendations(id) ON DELETE SET NULL,
  severity TEXT CHECK (severity IN ('info','watch','important','urgent')) DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT,
  goal_id UUID REFERENCES public.goals(id) ON DELETE SET NULL,
  status TEXT CHECK (status IN ('unread','read','dismissed','actioned')) DEFAULT 'unread',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_alerts_user ON public.alerts(user_id, severity, created_at DESC);
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts_all_own" ON public.alerts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 11. 决策日志
CREATE TABLE public.decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES public.recommendations(id) ON DELETE SET NULL,
  action TEXT CHECK (action IN ('viewed','followup_question','simulated','revoked','rejected','later','commented')) NOT NULL,
  reason TEXT,
  agent_snapshot JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_decision_user ON public.decision_logs(user_id, created_at DESC);
ALTER TABLE public.decision_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "decision_all_own" ON public.decision_logs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 12. 模拟采纳
CREATE TABLE public.simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES public.recommendations(id) ON DELETE CASCADE,
  before_snapshot JSONB DEFAULT '{}',
  after_snapshot JSONB DEFAULT '{}',
  expected_volatility_change NUMERIC(6,2),
  success_probability_delta NUMERIC(5,2),
  active BOOLEAN DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  effective_until DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sim_user ON public.simulations(user_id, active, created_at DESC);
ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sim_all_own" ON public.simulations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 触发器：新用户注册时自动创建 profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 触发器：更新 updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER goals_touch BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();