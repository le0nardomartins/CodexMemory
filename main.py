from __future__ import annotations

import json
import os
import sys
import traceback
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib import error, request


AGENTS_URI = "memory://agents"
SERVER_NAME = "codex-memory-mcp"
SERVER_VERSION = "1.0.0"
DEFAULT_PROTOCOL_VERSION = "2025-03-26"
PROMPT_FILENAME = "OLLAMA_prompt.md"


class TerminalUI:
    def __init__(self) -> None:
        self._line = "-" * 78

    def _ts(self) -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def banner(self) -> None:
        print(self._line, file=sys.stderr, flush=True)
        print(
            f"[{self._ts()}] [BOOT] Inicializando {SERVER_NAME} ({SERVER_VERSION})",
            file=sys.stderr,
            flush=True,
        )
        print(self._line, file=sys.stderr, flush=True)

    def info(self, stage: str, message: str) -> None:
        print(
            f"[{self._ts()}] [{stage:<10}] {message}",
            file=sys.stderr,
            flush=True,
        )

    def warn(self, stage: str, message: str) -> None:
        self.info(f"{stage} WARN", message)

    def error(self, stage: str, message: str) -> None:
        self.info(f"{stage} ERROR", message)


@dataclass
class AppPaths:
    root: Path
    prompt_file: Path
    context_dir: Path
    agents_file: Path


@dataclass
class ContextDoc:
    relative_path: str
    text: str
    absolute_path: Path


class AgentMemoryCoordinator:
    def __init__(
        self,
        paths: AppPaths,
        ui: TerminalUI,
        model: str,
        ollama_url: str,
        timeout_sec: int,
    ) -> None:
        self.paths = paths
        self.ui = ui
        self.model = model
        self.ollama_url = ollama_url.rstrip("/") + "/api/generate"
        self.timeout_sec = timeout_sec
        self.last_agents_text = ""
        self.unique_role = (
            "Curador de memoria do projeto CodexMemory: ler todos os contextos .md "
            "e consolidar um unico resumo operacional em AGENTS.md."
        )

    def context_paths(self) -> list[Path]:
        if not self.paths.context_dir.exists():
            return []
        return sorted(p for p in self.paths.context_dir.rglob("*.md") if p.is_file())

    def load_prompt(self) -> str:
        content = self.paths.prompt_file.read_text(encoding="utf-8").strip()
        if not content:
            raise ValueError(f"{self.paths.prompt_file.name} esta vazio.")
        return content

    def load_context_docs(self) -> list[ContextDoc]:
        docs: list[ContextDoc] = []
        for file_path in self.context_paths():
            try:
                text = file_path.read_text(encoding="utf-8").strip()
            except UnicodeDecodeError:
                text = file_path.read_text(encoding="utf-8", errors="replace").strip()

            relative_path = file_path.relative_to(self.paths.root).as_posix()
            docs.append(
                ContextDoc(
                    relative_path=relative_path,
                    text=text,
                    absolute_path=file_path,
                )
            )
        return docs

    def build_ollama_input(self, prompt_md: str, docs: list[ContextDoc]) -> str:
        parts = [
            "# Papel unico do Ollama",
            self.unique_role,
            "",
            "# Instrucoes base do projeto (OLLAMA_prompt.md)",
            prompt_md,
            "",
            "# Tarefa obrigatoria",
            "- Leia todos os arquivos de contexto abaixo.",
            "- Gere um unico resumo para AGENTS.md.",
            "- Nao invente dados ausentes; sinalize lacunas como pendencias.",
            "- Responda somente em Markdown com os blocos:",
            "  - Objetivo",
            "  - Regras operacionais",
            "  - Estado atual",
            "  - Proximas acoes",
            "",
            "# Contextos recebidos",
        ]

        if not docs:
            parts.append("[SEM ARQUIVOS DE CONTEXTO]")
        else:
            for doc in docs:
                parts.extend(
                    [
                        f"### {doc.relative_path}",
                        doc.text if doc.text else "(arquivo vazio)",
                        "",
                    ]
                )

        return "\n".join(parts).strip()

    def call_ollama(self, prompt: str) -> str:
        payload = {
            "model": self.model,
            "system": self.unique_role,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1},
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = request.Request(
            self.ollama_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=self.timeout_sec) as response:
            body = response.read()
        parsed = json.loads(body.decode("utf-8"))
        generated = str(parsed.get("response", "")).strip()
        if not generated:
            raise RuntimeError("Ollama respondeu sem texto em 'response'.")
        return generated

    def fallback_summary(self, docs: list[ContextDoc], err: Exception) -> str:
        lines = [
            "## Objetivo",
            "Consolidar contexto para o Codex, mas o Ollama nao respondeu.",
            "",
            "## Regras operacionais",
            f"- PAPEL FIXO: {self.unique_role}",
            "- Revisar arquivos de contexto manualmente ate o Ollama voltar.",
            "",
            "## Estado atual",
            f"- Erro no Ollama: {err}",
        ]

        if not docs:
            lines.append("- Nao ha arquivos de contexto em memory_voult/context.")
        else:
            lines.append("- Arquivos de contexto encontrados:")
            for doc in docs:
                preview = doc.text.replace("\n", " ").strip()
                if preview:
                    preview = preview[:180]
                else:
                    preview = "(arquivo vazio)"
                lines.append(f"  - {doc.relative_path}: {preview}")

        lines.extend(
            [
                "",
                "## Proximas acoes",
                "- Iniciar o servico do Ollama em http://127.0.0.1:11434.",
                f"- Confirmar que o modelo '{self.model}' esta instalado.",
            ]
        )
        return "\n".join(lines)

    def build_agents_file(self, summary: str, docs: list[ContextDoc]) -> str:
        now = datetime.now()
        first_line = f"{now.strftime('%Y-%m-%d')} | {now.strftime('%H:%M:%S')}"
        lines = [
            first_line,
            "# AGENTS",
            "",
            f"Papel unico do Ollama: {self.unique_role}",
            "",
            "## Resumo consolidado",
            summary.strip(),
            "",
            "## Arquivos de contexto processados",
        ]

        if not docs:
            lines.append("- Nenhum arquivo encontrado em memory_voult/context.")
        else:
            for doc in docs:
                lines.append(f"- {doc.relative_path}")

        return "\n".join(lines).rstrip() + "\n"

    def refresh_agents(self, reason: str, force_ollama: bool = True) -> str:
        self.ui.info("SYNC", f"Atualizando AGENTS.md ({reason})")
        prompt_md = self.load_prompt()
        docs = self.load_context_docs()
        self.ui.info(
            "SYNC",
            f"Prompt carregado ({self.paths.prompt_file.name}) e {len(docs)} arquivo(s) de contexto.",
        )

        summary = ""
        if force_ollama:
            prompt_for_ollama = self.build_ollama_input(prompt_md, docs)
            self.ui.info("OLLAMA", f"Chamando modelo '{self.model}' para consolidar contexto.")
            try:
                summary = self.call_ollama(prompt_for_ollama)
                self.ui.info("OLLAMA", "Resumo recebido do Ollama com sucesso.")
            except (error.URLError, error.HTTPError, TimeoutError, RuntimeError, OSError) as exc:
                self.ui.warn("OLLAMA", f"Falha ao consultar Ollama ({exc}). Usando fallback local.")
                summary = self.fallback_summary(docs, exc)
        else:
            summary = self.fallback_summary(docs, RuntimeError("Modo sem consulta ao Ollama."))

        agents_text = self.build_agents_file(summary=summary, docs=docs)
        self.paths.agents_file.parent.mkdir(parents=True, exist_ok=True)
        self.paths.agents_file.write_text(agents_text, encoding="utf-8")
        self.last_agents_text = agents_text
        self.ui.info("SYNC", f"AGENTS.md atualizado em {self.paths.agents_file.as_posix()}")
        return agents_text

    def get_agents_text(self) -> str:
        if self.last_agents_text:
            return self.last_agents_text
        if self.paths.agents_file.exists():
            self.last_agents_text = self.paths.agents_file.read_text(encoding="utf-8")
            return self.last_agents_text
        return self.refresh_agents(reason="AGENTS inexistente")


class MCPServer:
    def __init__(self, coordinator: AgentMemoryCoordinator, ui: TerminalUI):
        self.coordinator = coordinator
        self.ui = ui
        self.client_protocol_version = DEFAULT_PROTOCOL_VERSION
        self.running = True

    def send(self, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(encoded)}\r\n\r\n".encode("ascii")
        sys.stdout.buffer.write(header)
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()

    def send_response(self, request_id: Any, result: dict[str, Any]) -> None:
        self.send({"jsonrpc": "2.0", "id": request_id, "result": result})

    def send_error(self, request_id: Any, code: int, message: str) -> None:
        self.send(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": code, "message": message},
            }
        )

    def send_notification(self, method: str, params: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        self.send(payload)

    def read_message(self) -> dict[str, Any] | None:
        headers: dict[str, str] = {}
        while True:
            line = sys.stdin.buffer.readline()
            if not line:
                return None
            if line in (b"\r\n", b"\n"):
                break
            decoded = line.decode("ascii", errors="replace").strip()
            if ":" in decoded:
                key, value = decoded.split(":", 1)
                headers[key.strip().lower()] = value.strip()

        length = int(headers.get("content-length", "0"))
        if length <= 0:
            return None
        body = sys.stdin.buffer.read(length)
        if not body:
            return None
        return json.loads(body.decode("utf-8"))

    def handle_request(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        method = str(message.get("method", ""))
        params = message.get("params", {}) or {}
        self.ui.info("MCP", f"Request recebido: {method}")

        if method == "initialize":
            protocol_version = str(params.get("protocolVersion") or DEFAULT_PROTOCOL_VERSION)
            self.client_protocol_version = protocol_version
            agents_text = self.coordinator.refresh_agents(reason="conexao do Codex")
            result = {
                "protocolVersion": protocol_version,
                "capabilities": {
                    "resources": {"listChanged": True},
                },
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "instructions": agents_text,
            }
            self.send_response(request_id, result)
            self.ui.info("MCP", "AGENTS.md enviado ao Codex no initialize (instructions).")
            return

        if method == "ping":
            self.send_response(request_id, {})
            return

        if method == "resources/list":
            resources = [
                {
                    "uri": AGENTS_URI,
                    "name": "AGENTS.md",
                    "mimeType": "text/markdown",
                    "description": "Resumo consolidado dos contextos para o Codex.",
                }
            ]
            for context_file in self.coordinator.context_paths():
                relative = context_file.relative_to(self.coordinator.paths.root).as_posix()
                resources.append(
                    {
                        "uri": f"memory://context/{relative}",
                        "name": context_file.name,
                        "mimeType": "text/markdown",
                        "description": f"Arquivo de contexto: {relative}",
                    }
                )
            self.send_response(request_id, {"resources": resources})
            return

        if method == "resources/read":
            uri = str(params.get("uri", ""))
            if uri == AGENTS_URI:
                agents_text = self.coordinator.refresh_agents(reason="resources/read AGENTS")
                result = {
                    "contents": [
                        {
                            "uri": AGENTS_URI,
                            "mimeType": "text/markdown",
                            "text": agents_text,
                        }
                    ]
                }
                self.send_response(request_id, result)
                return

            context_prefix = "memory://context/"
            if uri.startswith(context_prefix):
                rel = uri.removeprefix(context_prefix)
                path = self.coordinator.paths.root / Path(rel)
                if not path.exists() or not path.is_file():
                    self.send_error(request_id, -32001, f"Contexto nao encontrado: {rel}")
                    return
                text = path.read_text(encoding="utf-8", errors="replace")
                result = {
                    "contents": [
                        {
                            "uri": uri,
                            "mimeType": "text/markdown",
                            "text": text,
                        }
                    ]
                }
                self.send_response(request_id, result)
                return

            self.send_error(request_id, -32602, f"URI nao suportada: {uri}")
            return

        self.send_error(request_id, -32601, f"Metodo nao suportado: {method}")

    def handle_notification(self, message: dict[str, Any]) -> None:
        method = str(message.get("method", ""))
        self.ui.info("MCP", f"Notification recebida: {method}")
        if method == "notifications/initialized":
            self.ui.info("MCP", "Codex conectado. Publicando AGENTS como resource MCP.")
            self.send_notification("notifications/resources/list_changed", {})

    def serve_forever(self) -> None:
        self.ui.info("MCP", "Servidor MCP ativo via stdio. Aguardando conexao do Codex.")
        while self.running:
            try:
                message = self.read_message()
                if message is None:
                    self.ui.warn("MCP", "Entrada encerrada. Finalizando servidor MCP.")
                    return

                if "method" in message and "id" in message:
                    self.handle_request(message)
                elif "method" in message:
                    self.handle_notification(message)
                else:
                    self.ui.warn("MCP", "Mensagem JSON-RPC ignorada (sem method).")
            except KeyboardInterrupt:
                self.ui.warn("MCP", "Interrompido pelo usuario.")
                return
            except Exception as exc:
                self.ui.error("MCP", f"Erro no loop principal: {exc}")
                tb = traceback.format_exc()
                for line in tb.strip().splitlines():
                    self.ui.error("TRACE", line)


def resolve_prompt_file(root: Path) -> Path:
    prompt_file = root / PROMPT_FILENAME
    legacy_prompt_file = root / "OLLAMA_PROMPT.md"

    if not prompt_file.exists() and legacy_prompt_file.exists():
        content = legacy_prompt_file.read_text(encoding="utf-8", errors="replace")
        prompt_file.write_text(content, encoding="utf-8")

    return prompt_file


def build_paths(root: Path) -> AppPaths:
    return AppPaths(
        root=root,
        prompt_file=resolve_prompt_file(root),
        context_dir=root / "memory_voult" / "context",
        agents_file=root / "memory_voult" / "AGENTS.md",
    )


def main() -> int:
    root = Path(__file__).resolve().parent
    ui = TerminalUI()
    ui.banner()

    model = os.getenv("OLLAMA_MODEL", "llama3.1")
    ollama_host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
    try:
        timeout_sec = int(os.getenv("OLLAMA_TIMEOUT_SEC", "120"))
    except ValueError:
        timeout_sec = 120
        ui.warn("CONFIG", "OLLAMA_TIMEOUT_SEC invalido. Usando 120s.")

    paths = build_paths(root)
    ui.info("CONFIG", f"Prompt: {paths.prompt_file.as_posix()}")
    ui.info("CONFIG", f"Contextos: {paths.context_dir.as_posix()}")
    ui.info("CONFIG", f"AGENTS: {paths.agents_file.as_posix()}")
    ui.info("CONFIG", f"Ollama: {ollama_host} | Modelo: {model}")

    coordinator = AgentMemoryCoordinator(
        paths=paths,
        ui=ui,
        model=model,
        ollama_url=ollama_host,
        timeout_sec=timeout_sec,
    )

    try:
        coordinator.refresh_agents(reason="boot do main")
    except Exception as exc:
        ui.error("BOOT", f"Falha na atualizacao inicial do AGENTS.md: {exc}")
        tb = traceback.format_exc()
        for line in tb.strip().splitlines():
            ui.error("TRACE", line)

    server = MCPServer(coordinator=coordinator, ui=ui)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
