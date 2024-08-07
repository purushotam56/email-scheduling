const express = require('express');
const router = express.Router();
const Email = require('./emailModel');
const { body, param, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');
const sgMail = require('@sendgrid/mail');
const moment = require('moment');

const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Create a new scheduled email
router.post('/',
    [
        body('recipients').isArray().withMessage('Recipients must be an array of valid email addresses'),
        body('recipients.*').isEmail().withMessage('Each recipient must be a valid email address'),
        body('subject').isString().escape().withMessage('Email subject is required'),
        body('email_text').isString().escape().withMessage('Email text is required'),
        body('scheduledTime').isISO8601().toDate().withMessage('Scheduled time must be a valid date').custom((value) => {
            const nowUtc = moment.utc();
            const scheduledTimeUtc = moment.utc(value);
            if (scheduledTimeUtc.isBefore(nowUtc)) {
                throw new Error('Scheduled time must be a future date or the current date and time');
            }
            return true;
        }),
    ],
    validateRequest, async (req, res) => {
        try {
            const { recipients, email_text, subject, scheduledTime } = req.body;
            const email = new Email({
                recipients,
                subject,
                email_text,
                scheduledTime: moment.utc(scheduledTime).toDate(),
            });
            await email.save();
            res.status(201).send(email);
        } catch (error) {
            res.status(400).send(error);
        }
    }
);

// Update an existing scheduled email
router.put('/:id',
    [
        param('id').custom((value) => {
            if (!isValidObjectId(value)) {
                throw new Error('Invalid email ID');
            }
            return true;
        }),
        body('recipients').optional().isArray().withMessage('Recipients must be an array of valid email addresses'),
        body('recipients.*').optional().isEmail().withMessage('Each recipient must be a valid email address'),
        body('subject').optional().isString().escape().withMessage('Subject is required'),
        body('email_text').optional().isString().escape().withMessage('Email text is required'),
        body('scheduledTime').optional().isISO8601().toDate().withMessage('Scheduled time must be a valid date').custom((value) => {
            const nowUtc = moment.utc();
            const scheduledTimeUtc = moment.utc(value);
            if (scheduledTimeUtc.isBefore(nowUtc)) {
                throw new Error('Scheduled time must be a future date or the current date and time');
            }
            return true;
        }),
    ],
    validateRequest, async (req, res) => {
        try {
            const { recipients, subject, email_text, scheduledTime } = req.body;
            const updateFields = {};

            // Construct the updateFields object with only the fields present in the request body
            if (recipients) updateFields.recipients = recipients;
            if (subject) updateFields.subject = subject;
            if (email_text) updateFields.email_text = email_text;
            if (scheduledTime) updateFields.scheduledTime = moment.utc(scheduledTime).toDate();

            // Find the email by ID and check its status
            const email = await Email.findById(req.params.id);

            if (!email) {
                return res.status(404).send({ message: 'Email not found' });
            }

            if (email.status !== 'scheduled') {
                return res.status(400).send({ message: 'Cannot update an email that has already been sent' });
            }

            // Update the email if it has not been sent
            const updatedEmail = await Email.findByIdAndUpdate(req.params.id, updateFields, {
                new: true,
                runValidators: true,
            });

            res.status(200).send(updatedEmail);
        } catch (error) {
            res.status(400).send({ error: error.message });
        }
    }
);

// Get all scheduled emails
router.get('/', async (req, res) => {
    try {
        const emails = await Email.find();
        res.status(200).send(emails);
    } catch (error) {
        res.status(500).send(error);
    }
});

// Delete a scheduled email
router.delete('/:id', async (req, res) => {
    try {
        const email = await Email.findByIdAndDelete(req.params.id);
        if (!email) {
            return res.status(404).send();
        }
        if(email.status !== 'scheduled'){
            return res.status(400).send({ message: 'Cannot delete an email that has already been sent or failed' });
        }
        res.status(200).send(email);
    } catch (error) {
        res.status(500).send(error);
    }
});

// Send scheduled emails
const sendScheduledEmails = async () => {
    const nowUtc = moment.utc().toDate();
    const emailsToSend = await Email.find({ 
        scheduledTime: { $lte: nowUtc },
        status: 'scheduled' 
    });

    for (let email of emailsToSend) {
        try {
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            const msg = {
                from: process.env.EMAIL_USER,
                to: email.recipients,
                subject: email.subject,
                text: email.email_text
            };
            await sgMail.send(msg);
            console.log('Email sent:', email._id);
            email.status = 'sent';
            await email.save();
        } catch (error) {
            console.error('Error sending email:', error);
            email.status = 'failed';
            await email.save();
        }
    }
};

setInterval(() => {
    try {
        sendScheduledEmails();
    } catch (error) {
        console.error('Error in scheduled email sending process:', error);
    }
}, 60000); // Check every miniute

module.exports = router;
