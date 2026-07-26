alter role cryptobot_netlify connection limit 20;
alter role cryptobot_netlify set statement_timeout = '15s';
alter role cryptobot_netlify set lock_timeout = '5s';
alter role cryptobot_netlify set idle_in_transaction_session_timeout = '15s';
