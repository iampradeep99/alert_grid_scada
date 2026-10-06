cd /var/www/alert-grid-scada-api/
npm install --omit=dev
npm run prod > /dev/null 2> /dev/null < /dev/null &
