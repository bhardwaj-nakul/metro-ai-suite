#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# RAG知识库检索脚本（Data Intelligence Engine）
# 用法: ./query_rag.sh "your question here" [top_k]
ENGINE_URL="${KB_ENGINE_URL:-http://localhost:16022}"
ENGINE_URL="${ENGINE_URL%/}"
LIBRARY="${KB_LIBRARY:-enterprise-kb}"
POOL="${KB_POOL:-}"
API_ENDPOINT="/v1/retrieve"
URL="${ENGINE_URL}${API_ENDPOINT}"
if [ $# -eq 0 ]; then
 echo "错误: 请提供查询问题"
 echo "用法: $0 \"your question here\" [top_k]"
 exit 1
fi
QUESTION="$1"
TOP_K="${2:-5}"

if [[ ! "$TOP_K" =~ ^[1-9][0-9]*$ ]]; then
 echo "错误: top_k 必须是正整数" >&2
 exit 2
fi

json_escape() {
 local value="$1" escaped="" char index
 for ((index = 0; index < ${#value}; index++)); do
  char="${value:index:1}"
  case "$char" in
   '"') escaped+='\"' ;;
   '\') escaped+='\\' ;;
   $'\b') escaped+='\b' ;;
   $'\f') escaped+='\f' ;;
   $'\n') escaped+='\n' ;;
   $'\r') escaped+='\r' ;;
   $'\t') escaped+='\t' ;;
   *) escaped+="$char" ;;
  esac
 done
 printf '%s' "$escaped"
}

POOLS_JSON=""
if [ -n "$POOL" ]; then
 POOLS_JSON="\"$(json_escape "$POOL")\""
fi

JSON_DATA=$(cat <<EOF
{
 "query": "$(json_escape "$QUESTION")",
 "libraries": ["$(json_escape "$LIBRARY")"],
 "asset_pool_ids": [$POOLS_JSON],
 "top_k": $TOP_K
}
EOF
)

if ! RESPONSE=$(curl -X POST "$URL" \
 -H "Content-Type: application/json" \
 -d "$JSON_DATA" \
 -s -S --fail-with-body); then
 echo "错误: 知识库检索失败 ($URL)" >&2
 echo "$RESPONSE" >&2
 exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
 echo "$RESPONSE"
 exit 0
fi

jq -r '
 if (.chunks | length) == 0 then
  "知识库中没有检索到相关内容。"
 else
  .chunks | to_entries[] |
   "[\(.key + 1)] score=\((.value.score * 1000 | round) / 1000) source=\(.value.metadata.file_name // .value.metadata.asset_id // "unknown")\n\(.value.text)\n"
 end
' <<<"$RESPONSE"
