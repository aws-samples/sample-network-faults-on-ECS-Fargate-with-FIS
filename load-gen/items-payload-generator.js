function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

const CATEGORIES = ["Electronics", "Books", "Clothing", "Home", "Sports"];
const PRICE_RANGES = [19.99, 49.99, 99.99, 199.99, 499.99];

function getRandomPrice() {
    return PRICE_RANGES[getRandomInt(PRICE_RANGES.length)];
}

module.exports = {
    generatePayloadData: (userContext, events, done) => {
        id = getRandomInt(1000)
        userContext.vars.name = `Test Item ${id}`;
        userContext.vars.description = `This is a detailed description for test item ${id}. It includes product features and specifications.`;
        userContext.vars.category = CATEGORIES[getRandomInt(CATEGORIES.length)];
        userContext.vars.price = getRandomPrice();

        return done();
    },
    printStatus: (requestParams, response, context, ee, next) => {
        console.log(`ENDPOINT: [${response.req.method}] ${response.req.path}: ${response.statusCode}`);
        if (response.statusCode >= 400) {
            console.warn(response.body);
        }
        return next();
    }
}
