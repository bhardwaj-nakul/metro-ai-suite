---
name: knowledgebase
description: "Generic RAG query skill - Retrieve any information from the local knowledge base and generate structured reports, summaries, or Q&A responses. Use for: product comparisons, technical analysis, documentation generation, competitive analysis, benchmark reports, specification queries, or any knowledge base retrieval task."
trigger: "When user needs to retrieve any information for any purpose."
user-invocable: true
allow-model-invocation: true
priority: high
---

# Knowledge Base - Generic Information Retrieval & Report Generation

Use this skill when the user wants to retrieve information from the local knowledge base and generate structured outputs (reports, summaries, comparisons, documentation).

The knowledge base is served by the Data Intelligence Engine. It returns the most relevant source text chunks for a question, **not a generated answer**. You must write the answer yourself from the returned chunks.

## 📋 QUICK START - Do This Immediately

When user asks a question, **execute the curl-based data_intelligence_engine wrapper via Bash**:

```javascript
Bash({
  command: '<SKILL_DIR>/data_intelligence_engine "user\'s question here"',
  description: "Query knowledge base"
})
```

Then answer the user based on the returned chunks. That's it!

**Example:** User asks "What is Intel Core Ultra 358H?"

**Your immediate action:**
```javascript
Bash({
  command: '<SKILL_DIR>/data_intelligence_engine "What is Intel Core Ultra 358H?"',
  description: "Query KB for Intel Core Ultra 358H"
})
// Wait for output, then answer the user from the returned chunks
```

## 🚨 CRITICAL EXECUTION REQUIREMENT 🚨

**YOU MUST EXECUTE COMMANDS USING THE BASH TOOL - DO NOT JUST DESCRIBE THEM!**

To query the knowledge base, you MUST:
1. Use the **Bash tool** to execute `<SKILL_DIR>/data_intelligence_engine "your question"`
2. Wait for the command to complete and get the output
3. Read the returned chunks and write the answer, report, or summary from them

Example Bash tool call:
```
Bash(
  command: '<SKILL_DIR>/data_intelligence_engine "What is Intel Core Ultra 358H?"',
  description: "Query knowledge base for Intel Core Ultra 358H specifications"
)
```

## Core Principles

⚠️ **ALWAYS use Bash tool to execute `<SKILL_DIR>/data_intelligence_engine` commands** ⚠️
⚠️ **Primary information source is `<SKILL_DIR>/data_intelligence_engine` output via Bash tool** ⚠️
⚠️ **Wait for Bash execution to complete before proceeding** ⚠️
⚠️ **Base the answer only on the returned chunks; if they do not contain the answer, say so instead of guessing** ⚠️

The main session can handle simple queries directly. For complex tasks, launch sub-agents.
For broad tasks (reports, comparisons), run several focused queries, one per product or topic, instead of one long question.

## Core Tool

### curl-based data_intelligence_engine Wrapper (Execute via Bash Tool)

Located at `<SKILL_DIR>/data_intelligence_engine`, this shell script calls the Data Intelligence Engine retrieval API (`POST /v1/retrieve`) directly with `curl`. It does not require Python or a virtual environment. If `jq` is installed, the output is a numbered list of chunks; otherwise it is the raw JSON response, where the final results are in `chunks`.

**CRITICAL: You MUST use the Bash tool to execute these commands!**

#### Usage via Bash Tool

```javascript
// Simple query (retrieves the top 5 chunks)
Bash({
  command: '<SKILL_DIR>/data_intelligence_engine "your question here"',
  description: "Query knowledge base"
})
```

Optional query settings:

```bash
<SKILL_DIR>/data_intelligence_engine "your question" --top-k 10
<SKILL_DIR>/data_intelligence_engine "your question" --library enterprise-kb --pool documents
```

Options:
- `--top-k N`: chunks retrieved (default 5); raise it when the answer needs more context
- `--library NAME`: asset library to search (default `enterprise-kb`)
- `--pool ID`: asset pool to search, repeatable (default: every pool in the library)

Example output (with `jq`):

```text
[1] score=0.809 source=intel_products.txt
Intel Core Ultra X7 358H is a mobile processor designed for high-performance laptops. ...

[2] score=0.412 source=intel_products.txt
...
```

Each chunk shows its rank, relevance score, and source file. Cite the source files when presenting results. If the output says no matching content was found, tell the user the knowledge base has no information on the question.

Connection settings are configured with environment variables:

```bash
export KB_ENGINE_URL="http://localhost:16022"
export KB_LIBRARY="enterprise-kb"
export KB_POOL=""
export KB_CONNECT_TIMEOUT="10"
```

> [!IMPORTANT]
>
> - `curl` must be available in `PATH`
> - ALWAYS use Bash tool to execute commands
> - Never skip execution - always run the command!
