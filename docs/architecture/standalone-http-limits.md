# Limites HTTP do backend standalone

O listener `node:http` aceita somente JSON de até **1 MiB** e headers de até
**16 KiB**. `Content-Length` maior, inválido ou um corpo que ultrapasse o
limite observado recebe `413 {"error":"Payload muito grande"}`. O corpo é
contado por bytes recebidos, portanto um `Content-Length` enganoso não contorna
o limite. Se o cliente declara menos bytes e envia mais, o parser HTTP do
Node rejeita o framing excedente antes do domínio. A leitura tem 15 s de
inatividade e seus timers são sempre limpos.

Headers devem chegar em 15 s. Não há `requestTimeout` global ou timeout de
socket: isso evita derrubar SSE, chat e etapas legítimas que podem ficar
silenciosas. Rotas JSON normais recebem 30 s após o corpo completo e retornam
`408 {"error":"Tempo de requisição esgotado"}`. `POST /api/chat/send` e
rotas de etapas não têm esse prazo de conclusão. Keep-alive ocioso é 5 s.

Essas regras pertencem apenas a `server/main.ts`; Vite e sua porta 5173 não
são configurados nem alterados.
