const cronParser = require("cron-parser");
console.log("CronExpressionParser Keys:", Object.keys(cronParser.CronExpressionParser));
console.log("CronExpressionParser Prototype Keys:", Object.keys(cronParser.CronExpressionParser.prototype));
try {
    const result = cronParser.CronExpressionParser.parse("0 9 * * *");
    console.log("Parse Success");
} catch (e) {
    console.log("Parse Error:", e.message);
}
