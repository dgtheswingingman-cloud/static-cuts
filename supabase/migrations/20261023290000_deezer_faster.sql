-- Deezer, faster: up to 60 calls a minute and 60,000 a day (Deezer itself
-- allows about 600 a minute). The timer now does up to 60 calls every 2
-- minutes, so about 30 a minute in practice.
update sc_private_settings set value = '60' where key = 'deezer_per_minute';
update sc_private_settings set value = '60000' where key = 'deezer_per_day';
