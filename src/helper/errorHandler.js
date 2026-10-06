export const jsonErrorHandler = (err, _req, res, _next) => {
  const statusCode = err.statusCode || err.httpStatusCode || 500;

  return res.status(statusCode).json({
    responseObject: null,
    responseDynamic: null,
    responseCode: '0',
    responseMessage: err.message || 'Internal server error',
    jsonString: null,
    recordCount: 0,
  });
};

export const jsonResponseHandler = (data, message, _req, res) => {
  return res.status(200).json({
    responseObject: null,
    responseDynamic: data || null,
    responseCode: '1',
    responseMessage: message || 'Success',
    jsonString: null,
    recordCount: Array.isArray(data) ? data.length : 0,
  });
};
