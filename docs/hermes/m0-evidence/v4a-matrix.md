| Id | Check | Verdict | Environment | Evidence |
|---|---|---|---|---|
| V4a-1 | initialize answers with the fixed protocol version whatever the client asked for | **PASS** | mock | asked 2025-06-18, got 2024-11-05 |
| V4a-2 | tools/list returns the catalogue (the calendar tools only where the database offers them) | **PASS** | mock | 18 tools: list_projects,search_documents,read_document,list_staff,recent_work,add_to_project,notebook_generate,push_to_notebook,ask_notebook,check_job,search_project,list_tasks,create_task,update_task,inspect_activity,ask_team,start_research,generate_artifact |
| V4a-3 | no credential is refused with 401 and a resource_metadata challenge | **PASS** | mock | status 401 |
| V4a-4 | an unknown credential is refused with 401 | **PASS** | mock | status 401 |
| V4a-5 | the office is the credential's own: office A's client sees only office A's projects | **PASS** | mock | slugs harvest-lane,budget-2027 |
| V4a-6 | office B's client sees only office B's projects | **PASS** | mock | slugs other-office-secret |
| V4a-7 | an office named in the arguments is overwritten with the credential's office | **PASS** | mock | database received p_office=11111111-1111-4111-8111-111111111111 (A is 11111111-1111-4111-8111-111111111111) |
| V4a-8 | a read-only client cannot make a write call: refused at the edge, the database function is never reached, the refusal is recorded | **PASS** | mock | code -32602, mcp_task_add calls 0, record outcomes refused |
| V4a-9 | a read+write client still reaches the write function, attributed to its own client id | **PASS** | mock | reached=true client=chatgpt-rw |
| V4a-10 | an unknown tool and a prototype-chain name are both "no such tool" | **PASS** | mock | codes -32601, -32601 |
| V4a-11 | a database error is reported as "the tool failed" and never repeats the schema detail | **PASS** | mock | code -32603; response {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"the tool failed"}} |
| V4a-12 | GET answers a JSON liveness reply (not an event stream and not 405): recorded, because a modern client may open a GET stream | **PASS** | mock | status 200 content-type application/json; charset=utf-8 |
| V4a-13 | notifications/initialized is acknowledged with 202 | **PASS** | mock | status 202 |
| V4a-14 | DELETE (streamable-HTTP session end) is answered 405 | **PASS** | mock | status 405 |
