# Private LLM Configuration Design

## Goal

Move project configuration into a dedicated `config/` directory and keep the
LLM provider URL, model name, and API key in a local file that Git cannot
commit. A missing private file must not prevent audio, vision, photo, or printer
features from starting, but attempts to enter an LLM mode must be explicitly
rejected.

## File layout

```text
config/
├── app.yaml
├── llm.example.yaml
└── llm.yaml
```

- `config/app.yaml` replaces the root `config.yaml`. It contains hardware,
  ASR, VAD, keyword, vision, application, printer, API, and non-secret LLM
  behavior settings.
- `config/llm.example.yaml` is committed and documents the expected provider
  fields using placeholders.
- `config/llm.yaml` is ignored by Git and contains the real provider URL,
  model name, and API key.

The private file has this shape:

```yaml
base_url: https://provider.example/v1
model: provider-model-name
api_key: replace-with-a-new-key
```

`llm.enabled`, request limits, logging, session limits, and mode phrases remain
under `llm:` in `config/app.yaml` because they are not secrets and should remain
version controlled.

## Loading and merge behavior

The command-line default changes from `config.yaml` to `config/app.yaml`. A
second optional argument, `--llm-config`, defaults to `config/llm.yaml`.

The loader first parses and validates `app.yaml`, then parses the private
provider file and applies its three fields to the LLM runtime configuration.
The private file is a narrow overlay: unrelated sections or unknown keys are
rejected so it cannot silently replace hardware or application settings.

When `llm.enabled` is false, the private file is optional and unused. When LLM
is enabled but `llm.yaml` is missing, the program logs a warning, marks the LLM
provider unavailable, and continues starting the other features. If the private
file exists but is malformed, contains unknown fields, or has empty
credentials, startup fails with a configuration error because silently
ignoring a damaged credential file would make diagnosis difficult.

LLM start-phrase detection remains active while the provider is unavailable.
If the user requests letter or question-answer mode, the controller does not
create a session or buffer that utterance. It emits `llm.session_rejected` with
the requested mode and a stable `not_configured` reason. Subsequent speech
continues through the normal non-LLM pipeline. When `llm.enabled` is explicitly
false, the same event uses the stable `disabled` reason. Rejected attempts never
call the provider or printer.

Explicit paths supplied through `--config` and `--llm-config` are honored.
Library callers may also pass both paths to `load_config`.

## Secret handling

`config/llm.yaml` is explicitly listed in `.gitignore`. The API key is stored in
memory on a field excluded from dataclass representations and is passed
directly to the OpenAI-compatible client. The client no longer interprets the
key as an environment-variable name.

No warning, exception, event payload, application log, or `logs/llm.log` entry
may contain the API key. Tests use sentinel values and scan representations and
captured logs for accidental disclosure.

The key currently present in the working copy must be treated as exposed and
must not be copied into a committed file. The user should revoke it and enter a
new key in the ignored `config/llm.yaml`.

## Migration

Implementation will:

1. Move the tracked root configuration to `config/app.yaml`.
2. Preserve the user's current non-secret local configuration changes.
3. Remove provider credentials from the public configuration.
4. Add the ignored private file path and a committed example template.
5. Update command examples and documentation to use the new paths.

No compatibility copy of root `config.yaml` will remain, avoiding two competing
sources of truth.

## Tests

Configuration tests cover:

- loading and merging the public and private YAML files;
- the new default paths and explicit overrides;
- disabled LLM with no private file;
- enabled LLM with no private file preserving all other features;
- unavailable or disabled LLM start phrases producing
  `llm.session_rejected` without buffering text;
- malformed, unknown, and empty private provider fields;
- API key exclusion from object representations and logs;
- preservation of all non-secret LLM mode/session settings.

Client and runtime tests are updated to pass an in-memory API key and continue
covering successful requests, failures, cancellation, buffering, and event
generation. The complete existing test suite must pass after the migration.
