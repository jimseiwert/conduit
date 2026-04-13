{{- define "conduit-relay.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "conduit-relay.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "conduit-relay.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "conduit-relay.selectorLabels" -}}
app.kubernetes.io/name: conduit-relay
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
