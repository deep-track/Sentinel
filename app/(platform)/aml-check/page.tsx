"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Shield, Search, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { searchAML } from "@/actions/aml";
import { getRiskLevelStyles, formatConfidenceScore, formatDatasets } from "@/lib/opensanctions";
import type { SanctionsSearchResult, RiskLevel } from "@/lib/opensanctions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  clear: "All Clear",
  low: "Low Risk",
  medium: "Medium Risk",
  high: "High Risk",
  sanctioned: "Sanctioned",
};

export default function AMLCheckPage() {
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SanctionsSearchResult | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Please enter a full name to search.");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await searchAML(fullName.trim(), country.trim() || undefined);
      if (!response.success || !response.data) {
        toast.error(response.error ?? "AML search failed. Please try again.");
        return;
      }
      setResult(response.data);
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const riskStyles = result ? getRiskLevelStyles(result.riskLevel) : null;

  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary text-primary-foreground">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AML Screening & Sanctions Check</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Search OpenSanctions database for individuals and entities
          </p>
        </div>
      </div>

      {/* Search Form */}
      <Card className="border-slate-200 dark:border-slate-700">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-white">Search</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full Name <span className="text-red-500">*</span></Label>
                <Input
                  id="fullName"
                  placeholder="e.g. John Smith"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="country">Country <span className="text-slate-400">(optional)</span></Label>
                <Input
                  id="country"
                  placeholder="e.g. US, GB, DE"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={loading || !fullName.trim()}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching…
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Search
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
          <span className="ml-3 text-slate-500 dark:text-slate-400">Screening against sanctions database…</span>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-6">
          {/* Risk Assessment Banner */}
          <div
            className={`rounded-xl border p-5 ${riskStyles?.bgColor} ${riskStyles?.borderColor}`}
          >
            <div className="flex items-start gap-4">
              <div className="mt-0.5">
                {result.riskLevel === "clear" ? (
                  <CheckCircle2 className={`h-6 w-6 ${riskStyles?.textColor}`} />
                ) : (
                  <AlertTriangle className={`h-6 w-6 ${riskStyles?.textColor}`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-base font-semibold ${riskStyles?.textColor}`}>
                    {RISK_LEVEL_LABELS[result.riskLevel]}
                  </span>
                  <Badge className={riskStyles?.badgeColor}>
                    {result.riskLevel.toUpperCase()}
                  </Badge>
                </div>
                <p className={`mt-1 text-sm ${riskStyles?.textColor}`}>
                  {result.assessment.summary}
                </p>
                <p className={`mt-1 text-xs ${riskStyles?.textColor} opacity-75`}>
                  {result.results.length === 0
                    ? "No matches found"
                    : `${result.results.length} match${result.results.length === 1 ? "" : "es"} found`}
                </p>
              </div>
            </div>
          </div>

          {/* Matched Records */}
          {result.results.length > 0 ? (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Matched Records ({result.results.length})
              </h2>
              {result.results.map((match) => (
                <Card key={match.id} className="border-slate-200 dark:border-slate-700">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {match.caption}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {formatConfidenceScore(match.score)} confidence
                          </Badge>
                        </div>

                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                          <div className="flex gap-1.5">
                            <dt className="text-slate-500 dark:text-slate-400 shrink-0">Sources:</dt>
                            <dd className="text-slate-700 dark:text-slate-300 truncate">
                              {formatDatasets(match.datasets)}
                            </dd>
                          </div>
                          {match.countries && match.countries.length > 0 && (
                            <div className="flex gap-1.5">
                              <dt className="text-slate-500 dark:text-slate-400 shrink-0">Countries:</dt>
                              <dd className="text-slate-700 dark:text-slate-300">
                                {match.countries.join(", ")}
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>

                      <Link
                        href={`/aml/profile/${encodeURIComponent(match.id)}`}
                        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-200 transition-colors bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/40 px-3 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800"
                      >
                        View Full Profile
                        <span aria-hidden>→</span>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            /* Empty state */
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10 p-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
              <h3 className="font-semibold text-emerald-800 dark:text-emerald-200">No Matches Found</h3>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                <strong>{result.query}</strong> does not appear in any sanctions or PEP lists.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
