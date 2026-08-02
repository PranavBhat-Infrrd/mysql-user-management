{{- define "mysql-user-mgmt.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "mysql-user-mgmt.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "mysql-user-mgmt.name" . -}}
{{- end -}}
{{- end -}}

{{- define "mysql-user-mgmt.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "mysql-user-mgmt.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
