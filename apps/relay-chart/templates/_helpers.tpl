{{- define "tunnel-relay.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "tunnel-relay.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "tunnel-relay.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "tunnel-relay.selectorLabels" -}}
app.kubernetes.io/name: tunnel-relay
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
