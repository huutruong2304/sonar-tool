import { NextRequest, NextResponse } from "next/server";

type SourceRequest = { url?: string; token?: string; projectKey?: string; branch?: string };
type SonarMeasure = { metric: string; value?: string; periods?: Array<{ value: string }> };
type SonarIssue = { key: string; severity?: string; type?: string; message: string; component: string; line?: number; effort?: string; rule?: string; tags?: string[] };
const metricKeys = ["coverage", "new_coverage", "bugs", "new_bugs", "vulnerabilities", "new_vulnerabilities", "code_smells", "new_code_smells", "security_hotspots", "new_security_hotspots", "duplicated_lines_density", "new_duplicated_lines_density", "ncloc"];
function numeric(measures: SonarMeasure[], key: string) { const item = measures.find((m) => m.metric === key); return Number(item?.periods?.[0]?.value ?? item?.value ?? 0); }

export async function POST(request: NextRequest) {
  try {
    const { url, token, projectKey, branch } = await request.json() as SourceRequest;
    if (!url || !token || !projectKey) return NextResponse.json({ error: "Thiếu URL, token hoặc project key" }, { status: 400 });
    let origin: URL;
    try { origin = new URL(url); } catch { return NextResponse.json({ error: "SonarQube URL không hợp lệ" }, { status: 400 }); }
    if (!["http:", "https:"].includes(origin.protocol)) return NextResponse.json({ error: "Chỉ hỗ trợ URL HTTP/HTTPS" }, { status: 400 });
    const auth = `Basic ${btoa(`${token}:`)}`;
    const call = async (path: string, params: Record<string, string>) => {
      const endpoint = new URL(path, origin);
      Object.entries(params).forEach(([key, value]) => value && endpoint.searchParams.set(key, value));
      const res = await fetch(endpoint, { headers: { Authorization: auth, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "Token không hợp lệ hoặc thiếu quyền Browse" : `SonarQube trả về HTTP ${res.status}`);
      return res.json();
    };
    const measuresResponse = await call("/api/measures/component", { component: projectKey, branch: branch || "", metricKeys: metricKeys.join(",") });
    const measures: SonarMeasure[] = measuresResponse.component?.measures || [];
    const fetchIssues = async (newOnly: boolean) => {
      const issues: SonarIssue[] = []; let page = 1; let total = 0;
      do { const response = await call("/api/issues/search", { components: projectKey, branch: branch || "", resolved: "false", ps: "500", p: String(page), ...(newOnly ? { sinceLeakPeriod: "true" } : {}) }); issues.push(...(response.issues || [])); total = response.paging?.total ?? response.total ?? issues.length; page += 1; } while (issues.length < total && page <= 20);
      return issues;
    };
    const [allIssues, newIssues] = await Promise.all([fetchIssues(false), fetchIssues(true)]);
    const newKeys = new Set(newIssues.map((issue) => issue.key));
    const normalizeSeverity = (severity?: string) => ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"].includes(severity || "") ? severity : severity === "HIGH" ? "CRITICAL" : severity === "MEDIUM" ? "MAJOR" : severity === "LOW" ? "MINOR" : "INFO";
    const normalizeType = (type?: string) => ["BUG", "VULNERABILITY", "CODE_SMELL", "SECURITY_HOTSPOT"].includes(type || "") ? type : "CODE_SMELL";
    return NextResponse.json({ metrics: { coverage: numeric(measures, "coverage"), newCoverage: numeric(measures, "new_coverage"), bugs: numeric(measures, "bugs"), newBugs: numeric(measures, "new_bugs"), vulnerabilities: numeric(measures, "vulnerabilities"), newVulnerabilities: numeric(measures, "new_vulnerabilities"), codeSmells: numeric(measures, "code_smells"), newCodeSmells: numeric(measures, "new_code_smells"), hotspots: numeric(measures, "security_hotspots"), newHotspots: numeric(measures, "new_security_hotspots"), duplications: numeric(measures, "duplicated_lines_density"), newDuplications: numeric(measures, "new_duplicated_lines_density"), lines: numeric(measures, "ncloc") }, issues: allIssues.map((issue) => ({ key: issue.key, severity: normalizeSeverity(issue.severity), type: normalizeType(issue.type), message: issue.message, component: issue.component.replace(`${projectKey}:`, ""), line: issue.line, effort: issue.effort, rule: issue.rule, tags: issue.tags || [], isNew: newKeys.has(issue.key) })) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể đọc dữ liệu SonarQube" }, { status: 502 }); }
}
