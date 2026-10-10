# PM → Factory integration run

- platform: linux/x64 · node v22.22.0 · Python 3.13.16
- Prompt Maker HEAD: `20f61a8956aadd5f16953c42abefbd627c12234f`
- Factory HEAD: `c8b264eaaf2857b43aced0c3ee36a9f01daa0545`

| scenario | viewport | stack | decision | evaluate | materialize | profile |
|---|---|---|---|---|---|---|
| new_react_desktop | desktop | `react-vite-supabase` | CONFIRMED | 0 | 0 | react-vite-supabase |
| new_react_390 | 390px | `react-vite-supabase` | CONFIRMED | 0 | 0 | react-vite-supabase |
| new_flutter | desktop | `flutter-supabase` | CONFIRMED | 0 | 0 | flutter-supabase |
| existing_react | desktop | `react-vite-supabase` | CONFIRMED | 0 | 0 | react-vite-supabase |
| alias_documented | desktop | `React + Vite + Supabase` | CONFIRMED | 0 | 0 | react-vite-supabase |
| unsupported_stack | desktop | `Django + HTMX` | CONFIRMED | 11 | 11 | — |
| undecided_deferred | desktop | `null` | REQUIRES_DECISION | 10 | 10 | — |
| unsupported_schema_from_ui_bp | desktop | `react-vite-supabase` | CONFIRMED | 13 | 13 | — |

## Checks

- PASS `env.factory_checkout_clean_before`
- PASS `contract.pin_producer_commit`
- PASS `contract.pin_schema_1_1_subset_1`
- PASS `contract.pinned_files_equal_current_prompt_maker`
- PASS `contract.producer_commit_is_ancestor_of_pm_head`
- PASS `contract.producer_sources_unchanged_since_pin`
- PASS `new_react_desktop.ui_no_page_errors`
- PASS `new_react_desktop.blueprint_schema_1_1`
- PASS `new_react_desktop.technology_confirmed_by_user`
- PASS `new_react_desktop.blueprint_new_project`
- PASS `new_react_desktop.evaluate_exit_0`
- PASS `new_react_desktop.materialize_exit_0`
- PASS `new_react_desktop.profile_react-vite-supabase`
- PASS `new_react_desktop.provenance_producer_commit_pinned`
- PASS `new_react_desktop.provenance_every_file_sha256_recomputes`
- PASS `new_react_desktop.subset_sha256_and_equals_factory_extract`
- PASS `new_react_desktop.subset_equals_prompt_maker_producer_extract`
- PASS `new_react_desktop.docs_ai_complete_23`
- PASS `new_react_desktop.no_secret_residue`
- PASS `new_react_desktop.no_unresolved_tokens`
- PASS `new_react_desktop.scope_note_not_execution_authority`
- PASS `new_react_desktop.scaffold_has_vite_env_d_ts`
- PASS `new_react_desktop.typecheck_import_meta_env_no_TS2339`
- PASS `new_react_390.ui_no_page_errors`
- PASS `new_react_390.blueprint_schema_1_1`
- PASS `new_react_390.technology_confirmed_by_user`
- PASS `new_react_390.blueprint_new_project`
- PASS `new_react_390.evaluate_exit_0`
- PASS `new_react_390.materialize_exit_0`
- PASS `new_react_390.profile_react-vite-supabase`
- PASS `new_react_390.provenance_producer_commit_pinned`
- PASS `new_react_390.provenance_every_file_sha256_recomputes`
- PASS `new_react_390.subset_sha256_and_equals_factory_extract`
- PASS `new_react_390.subset_equals_prompt_maker_producer_extract`
- PASS `new_react_390.docs_ai_complete_23`
- PASS `new_react_390.no_secret_residue`
- PASS `new_react_390.no_unresolved_tokens`
- PASS `new_react_390.scope_note_not_execution_authority`
- PASS `new_react_390.scaffold_has_vite_env_d_ts`
- PASS `new_flutter.ui_no_page_errors`
- PASS `new_flutter.blueprint_schema_1_1`
- PASS `new_flutter.technology_confirmed_by_user`
- PASS `new_flutter.blueprint_new_project`
- PASS `new_flutter.evaluate_exit_0`
- PASS `new_flutter.materialize_exit_0`
- PASS `new_flutter.profile_flutter-supabase`
- PASS `new_flutter.provenance_producer_commit_pinned`
- PASS `new_flutter.provenance_every_file_sha256_recomputes`
- PASS `new_flutter.subset_sha256_and_equals_factory_extract`
- PASS `new_flutter.subset_equals_prompt_maker_producer_extract`
- PASS `new_flutter.docs_ai_complete_23`
- PASS `new_flutter.no_secret_residue`
- PASS `new_flutter.no_unresolved_tokens`
- PASS `new_flutter.scope_note_not_execution_authority`
- PASS `existing_react.ui_no_page_errors`
- PASS `existing_react.blueprint_schema_1_1`
- PASS `existing_react.technology_confirmed_by_user`
- PASS `existing_react.blueprint_brownfield_from_confirmed_context`
- PASS `existing_react.evaluate_exit_0`
- PASS `existing_react.materialize_exit_0`
- PASS `existing_react.profile_react-vite-supabase`
- PASS `existing_react.provenance_producer_commit_pinned`
- PASS `existing_react.provenance_every_file_sha256_recomputes`
- PASS `existing_react.subset_sha256_and_equals_factory_extract`
- PASS `existing_react.subset_equals_prompt_maker_producer_extract`
- PASS `existing_react.docs_ai_complete_23`
- PASS `existing_react.no_secret_residue`
- PASS `existing_react.no_unresolved_tokens`
- PASS `existing_react.scope_note_not_execution_authority`
- PASS `existing_react.scaffold_has_vite_env_d_ts`
- PASS `existing_react.no_clobber_user_package_json_preserved`
- PASS `existing_react.no_clobber_user_prd_preserved`
- PASS `existing_react.no_clobber_reported_in_output`
- PASS `existing_react.idempotent_second_run_changes_nothing`
- PASS `alias_documented.ui_no_page_errors`
- PASS `alias_documented.blueprint_schema_1_1`
- PASS `alias_documented.technology_confirmed_by_user`
- PASS `alias_documented.blueprint_new_project`
- PASS `alias_documented.evaluate_exit_0`
- PASS `alias_documented.materialize_exit_0`
- PASS `alias_documented.profile_react-vite-supabase`
- PASS `alias_documented.provenance_producer_commit_pinned`
- PASS `alias_documented.provenance_every_file_sha256_recomputes`
- PASS `alias_documented.subset_sha256_and_equals_factory_extract`
- PASS `alias_documented.subset_equals_prompt_maker_producer_extract`
- PASS `alias_documented.docs_ai_complete_23`
- PASS `alias_documented.no_secret_residue`
- PASS `alias_documented.no_unresolved_tokens`
- PASS `alias_documented.scope_note_not_execution_authority`
- PASS `alias_documented.scaffold_has_vite_env_d_ts`
- PASS `unsupported_stack.ui_no_page_errors`
- PASS `unsupported_stack.blueprint_schema_1_1`
- PASS `unsupported_stack.technology_confirmed_by_user`
- PASS `unsupported_stack.blueprint_new_project`
- PASS `unsupported_stack.evaluate_exit_11`
- PASS `unsupported_stack.materialize_exit_11`
- PASS `unsupported_stack.blocked_touches_no_filesystem`
- PASS `unsupported_stack.no_substitute_profile_chosen`
- PASS `undecided_deferred.ui_no_page_errors`
- PASS `undecided_deferred.blueprint_schema_1_1`
- PASS `undecided_deferred.technology_not_decided`
- PASS `undecided_deferred.blueprint_new_project`
- PASS `undecided_deferred.evaluate_exit_10`
- PASS `undecided_deferred.materialize_exit_10`
- PASS `undecided_deferred.blocked_touches_no_filesystem`
- PASS `undecided_deferred.no_substitute_profile_chosen`
- PASS `unsupported_schema_from_ui_bp.ui_no_page_errors`
- PASS `unsupported_schema_from_ui_bp.blueprint_schema_1_1`
- PASS `unsupported_schema_from_ui_bp.technology_confirmed_by_user`
- PASS `unsupported_schema_from_ui_bp.blueprint_new_project`
- PASS `unsupported_schema_from_ui_bp.evaluate_exit_13`
- PASS `unsupported_schema_from_ui_bp.materialize_exit_13`
- PASS `unsupported_schema_from_ui_bp.blocked_touches_no_filesystem`
- PASS `ui.desktop_and_390_same_consumer_subset`
- PASS `env.factory_checkout_unmodified_after`

## NOT_RUN

- NOT_RUN `new_react_desktop.npm_install_and_build` — npm registry unreachable in this environment (ENOTFOUND)
- NOT_RUN `new_flutter.flutter_pub_get_analyze_test` — flutter SDK not installed in this environment
- NOT_RUN `windows.end_to_end` — this run is on linux; run the same tool on Windows (see docs/WINDOWS_INTEGRATION_VERIFICATION_AR.md)

**Summary:** 115 executed checks, 0 failed, 3 NOT_RUN. The UI user is simulated (not human UAT); materialization is a starting project, not production readiness.
