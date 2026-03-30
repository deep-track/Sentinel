import { notFound } from "next/navigation";
import { getEntityById } from "@/lib/opensanctions";
import { getAMLRiskLevel } from "@/lib/opensanctions";
import Link from "next/link";
import {
  Shield,
  AlertTriangle,
  XCircle,
  CheckCircle,
  ArrowLeft,
  User,
  Globe,
  Calendar,
  FileText,
  AlertCircle,
  Database,
} from "lucide-react";

export default async function AMLProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let entity;
  try {
    entity = await getEntityById(id);
  } catch {
    entity = null;
  }

  if (!entity) notFound();

  const riskLevel = getAMLRiskLevel([entity]);

  const RISK_STYLES = {
    clear:      { bg: "bg-emerald-50 dark:bg-emerald-900/10", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800", label: "Clear" },
    low:        { bg: "bg-blue-50 dark:bg-blue-900/10",     text: "text-blue-700 dark:text-blue-400",     border: "border-blue-200 dark:border-blue-800",     label: "Low Risk" },
    medium:     { bg: "bg-amber-50 dark:bg-amber-900/10",   text: "text-amber-700 dark:text-amber-400",   border: "border-amber-200 dark:border-amber-800",   label: "Medium Risk" },
    high:       { bg: "bg-orange-50 dark:bg-orange-900/10", text: "text-orange-700 dark:text-orange-400", border: "border-orange-200 dark:border-orange-800", label: "High Risk" },
    sanctioned: { bg: "bg-red-50 dark:bg-red-900/10",      text: "text-red-700 dark:text-red-400",       border: "border-red-200 dark:border-red-800",       label: "Sanctioned" },
  };

  const risk = RISK_STYLES[riskLevel];
  const score = Math.round((entity.score ?? 0) * 100);

  const p = entity.properties ?? {};

  // Helper to render a property row
  function PropRow({
    label,
    values,
    icon: Icon,
  }: {
    label: string;
    values?: string[];
    icon?: React.ElementType;
  }) {
    if (!values || values.length === 0) return null;
    return (
      <div className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
        <div className="flex items-center gap-2 w-40 flex-shrink-0">
          {Icon && (
            <Icon className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {label}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <span
              key={i}
              className="text-sm text-slate-800 dark:text-slate-200"
            >
              {v}{i < values.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-4xl mx-auto">

      {/* Back button */}
      <Link
        href="/aml-check"
        className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to AML Check
      </Link>

      {/* Header card */}
      <div className={`rounded-2xl border ${risk.border} ${risk.bg} p-6`}>
        <div className="flex items-start gap-4">
          <div className={`h-14 w-14 rounded-full border-2 ${risk.border} flex items-center justify-center flex-shrink-0 bg-white dark:bg-slate-900`}>
            {riskLevel === "sanctioned" ? (
              <XCircle className={`h-7 w-7 ${risk.text}`} />
            ) : riskLevel === "high" ? (
              <AlertTriangle className={`h-7 w-7 ${risk.text}`} />
            ) : riskLevel === "medium" ? (
              <AlertCircle className={`h-7 w-7 ${risk.text}`} />
            ) : (
              <Shield className={`h-7 w-7 ${risk.text}`} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {entity.caption}
              </h1>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${risk.text} ${risk.border} ${risk.bg}`}>
                {risk.label}
              </span>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                score >= 90 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                : score >= 70 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                : score >= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              }`}>
                {score}% match
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded font-mono">
                {entity.schema}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                ID: {entity.id}
              </span>
            </div>

            {/* Topics / risk categories */}
            {p.topics && p.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {p.topics.map((t) => (
                  <span
                    key={t}
                    className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — Personal details */}
        <div className="lg:col-span-2 space-y-4">

          {/* Identity */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
            <div className="flex items-center gap-2 mb-4">
              <User className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Identity
              </h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <PropRow label="Full Name"      values={p.name}        icon={User} />
              <PropRow label="Date of Birth"  values={p.birthDate}   icon={Calendar} />
              <PropRow label="Nationality"    values={p.nationality} icon={Globe} />
              <PropRow label="Country"        values={p.country}     icon={Globe} />
            </div>
          </div>

          {/* Sanctions details */}
          {(p.program || p.notes) && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-6">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <h2 className="text-sm font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">
                  Sanctions Details
                </h2>
              </div>
              <div className="divide-y divide-red-100 dark:divide-red-900/30">
                <PropRow label="Program"       values={p.program}    icon={Shield} />
                <PropRow label="Topics"        values={p.topics}     icon={AlertTriangle} />
              </div>
            </div>
          )}

          {/* Notes */}
          {p.notes && p.notes.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-4 w-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Notes
                </h2>
              </div>
              <div className="space-y-2">
                {p.notes.map((note, i) => (
                  <p key={i} className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {note}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right — Sources */}
        <div className="space-y-4">

          {/* Risk summary */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-4">
              Risk Summary
            </h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-400 mb-1">Risk Level</p>
                <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg border ${risk.text} ${risk.border} ${risk.bg}`}>
                  {risk.label}
                </span>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Match Score</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        score >= 90 ? "bg-red-500"
                        : score >= 70 ? "bg-orange-500"
                        : score >= 50 ? "bg-amber-500"
                        : "bg-blue-500"
                      }`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                    {score}%
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Entity Type</p>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {entity.schema}
                </p>
              </div>
            </div>
          </div>

          {/* Data sources */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Database className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Data Sources
              </h2>
            </div>
            <div className="space-y-1.5">
              {entity.datasets.map((ds) => (
                <div
                  key={ds}
                  className="text-xs font-mono bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2.5 py-1.5 rounded-lg"
                >
                  {ds}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
              {entity.datasets.length} source{entity.datasets.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Record ID */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Record ID
            </h2>
            <p className="text-xs font-mono text-slate-500 dark:text-slate-400 break-all">
              {entity.id}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
              Powered by OpenSanctions
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
