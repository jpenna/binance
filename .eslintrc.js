module.exports = {
  "extends": "airbnb-base",
  "rules": {
    "object-curly-newline": ["error", {
      "ObjectPattern": {
        "multiline": false
      },
      "ImportDeclaration": {
        "consistent": true
      }
    }],
    "consistent-return": 0,
    "max-len": [1, {
      "code": 100,
      "tabWidth": 2,
      "ignoreUrls": true,
      "ignoreTrailingComments": true,
    }],
    "no-plusplus": 0,
    "prefer-arrow-callback": 0,
    "no-restricted-syntax": 0,
    "no-underscore-dangle": 0,
    "no-param-reassign": 0,
  }
};
