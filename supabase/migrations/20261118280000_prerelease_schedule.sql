-- Store pre-releases: start the hourly job (sc_prerelease_step) once the
-- owner has seen what its first run does (139 songs held as announced, no
-- status events; each released on its date, logged).
select cron.schedule('prerelease-step', '41 * * * *', $c$ select public.sc_prerelease_step(); $c$);
